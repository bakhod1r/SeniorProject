# Strings and Methods — Practice Tasks

---

## Junior Tasks (3-4)

### Task 1: Palindrome Checker

Write a method that checks if a given string is a palindrome (reads the same forwards and backwards). Ignore case and non-alphanumeric characters.

**Input:** `"A man, a plan, a canal: Panama"`
**Expected output:** `true`

**Input:** `"hello"`
**Expected output:** `false`

<details>
<summary>Solution</summary>

```java
public class PalindromeChecker {
    public static boolean isPalindrome(String s) {
        // Remove non-alphanumeric and convert to lowercase
        String cleaned = s.replaceAll("[^a-zA-Z0-9]", "").toLowerCase();

        int left = 0;
        int right = cleaned.length() - 1;

        while (left < right) {
            if (cleaned.charAt(left) != cleaned.charAt(right)) {
                return false;
            }
            left++;
            right--;
        }
        return true;
    }

    public static void main(String[] args) {
        System.out.println(isPalindrome("A man, a plan, a canal: Panama")); // true
        System.out.println(isPalindrome("hello"));                           // false
        System.out.println(isPalindrome("racecar"));                         // true
        System.out.println(isPalindrome(""));                                // true
    }
}
```
</details>

---

### Task 2: Word Counter

Write a method that counts the number of words in a string. Words are separated by one or more spaces.

**Input:** `"  Hello   World  Java  "`
**Expected output:** `3`

**Input:** `""`
**Expected output:** `0`

<details>
<summary>Solution</summary>

```java
public class WordCounter {
    public static int countWords(String s) {
        if (s == null || s.isBlank()) return 0;
        return s.strip().split("\\s+").length;
    }

    public static void main(String[] args) {
        System.out.println(countWords("  Hello   World  Java  ")); // 3
        System.out.println(countWords(""));                         // 0
        System.out.println(countWords("   "));                      // 0
        System.out.println(countWords("single"));                   // 1
    }
}
```
</details>

---

### Task 3: Caesar Cipher

Implement a Caesar cipher that shifts each letter by a given number of positions. Non-letter characters should remain unchanged. Handle both uppercase and lowercase.

**Input:** `encrypt("Hello, World!", 3)`
**Expected output:** `"Khoor, Zruog!"`

**Input:** `decrypt("Khoor, Zruog!", 3)`
**Expected output:** `"Hello, World!"`

<details>
<summary>Solution</summary>

```java
public class CaesarCipher {
    public static String encrypt(String text, int shift) {
        StringBuilder result = new StringBuilder();
        shift = shift % 26; // normalize shift

        for (char c : text.toCharArray()) {
            if (Character.isLetter(c)) {
                char base = Character.isUpperCase(c) ? 'A' : 'a';
                char shifted = (char) ((c - base + shift + 26) % 26 + base);
                result.append(shifted);
            } else {
                result.append(c);
            }
        }
        return result.toString();
    }

    public static String decrypt(String text, int shift) {
        return encrypt(text, -shift);
    }

    public static void main(String[] args) {
        String encrypted = encrypt("Hello, World!", 3);
        System.out.println(encrypted);                    // Khoor, Zruog!
        System.out.println(decrypt(encrypted, 3));        // Hello, World!
        System.out.println(encrypt("xyz", 3));            // abc
    }
}
```
</details>

---

### Task 4: String Reversal (Multiple Ways)

Reverse a string using three different approaches: (1) StringBuilder, (2) char array, (3) recursion.

**Input:** `"Hello World"`
**Expected output:** `"dlroW olleH"`

<details>
<summary>Solution</summary>

```java
public class StringReversal {

    // Approach 1: StringBuilder
    public static String reverseWithBuilder(String s) {
        return new StringBuilder(s).reverse().toString();
    }

    // Approach 2: char array
    public static String reverseWithArray(String s) {
        char[] chars = s.toCharArray();
        int left = 0, right = chars.length - 1;
        while (left < right) {
            char temp = chars[left];
            chars[left] = chars[right];
            chars[right] = temp;
            left++;
            right--;
        }
        return new String(chars);
    }

    // Approach 3: Recursion
    public static String reverseRecursive(String s) {
        if (s.length() <= 1) return s;
        return reverseRecursive(s.substring(1)) + s.charAt(0);
    }

    public static void main(String[] args) {
        String input = "Hello World";
        System.out.println(reverseWithBuilder(input)); // dlroW olleH
        System.out.println(reverseWithArray(input));   // dlroW olleH
        System.out.println(reverseRecursive(input));   // dlroW olleH
    }
}
```
</details>

---

## Middle Tasks (2-3)

### Task 1: Custom String.format() Implementation

Implement a simplified version of `String.format()` that supports `%s` (string), `%d` (integer), and `%f` (float with 2 decimal places) placeholders.

**Input:** `format("Name: %s, Age: %d, GPA: %f", "Alice", 30, 3.856)`
**Expected output:** `"Name: Alice, Age: 30, GPA: 3.86"`

<details>
<summary>Solution</summary>

```java
public class CustomFormatter {

    public static String format(String template, Object... args) {
        StringBuilder result = new StringBuilder();
        int argIndex = 0;

        for (int i = 0; i < template.length(); i++) {
            if (template.charAt(i) == '%' && i + 1 < template.length()) {
                if (argIndex >= args.length) {
                    throw new IllegalArgumentException(
                        "Not enough arguments for format string");
                }

                char spec = template.charAt(i + 1);
                switch (spec) {
                    case 's' -> result.append(String.valueOf(args[argIndex++]));
                    case 'd' -> {
                        if (args[argIndex] instanceof Number n) {
                            result.append(n.longValue());
                        } else {
                            throw new IllegalArgumentException(
                                "Expected number for %d, got: " + args[argIndex]);
                        }
                        argIndex++;
                    }
                    case 'f' -> {
                        if (args[argIndex] instanceof Number n) {
                            result.append(String.format("%.2f", n.doubleValue()));
                        } else {
                            throw new IllegalArgumentException(
                                "Expected number for %f, got: " + args[argIndex]);
                        }
                        argIndex++;
                    }
                    case '%' -> result.append('%'); // escaped %
                    default -> throw new IllegalArgumentException(
                        "Unknown format specifier: %" + spec);
                }
                i++; // skip the specifier character
            } else {
                result.append(template.charAt(i));
            }
        }
        return result.toString();
    }

    public static void main(String[] args) {
        System.out.println(format("Name: %s, Age: %d, GPA: %f", "Alice", 30, 3.856));
        // Name: Alice, Age: 30, GPA: 3.86

        System.out.println(format("Hello, %s! You have %d new messages.", "Bob", 5));
        // Hello, Bob! You have 5 new messages.

        System.out.println(format("100%% complete"));
        // 100% complete
    }
}
```
</details>

---

### Task 2: Anagram Grouper

Given a list of strings, group all anagrams together. Two strings are anagrams if they contain the same characters in different order.

**Input:** `["eat", "tea", "tan", "ate", "nat", "bat"]`
**Expected output:** `[["eat", "tea", "ate"], ["tan", "nat"], ["bat"]]`

<details>
<summary>Solution</summary>

```java
import java.util.*;
import java.util.stream.*;

public class AnagramGrouper {

    public static List<List<String>> groupAnagrams(String[] words) {
        return new ArrayList<>(
            Arrays.stream(words)
                .collect(Collectors.groupingBy(word -> {
                    char[] chars = word.toLowerCase().toCharArray();
                    Arrays.sort(chars);
                    return new String(chars);
                }))
                .values()
        );
    }

    // Alternative: frequency-based key (avoids sorting)
    public static List<List<String>> groupAnagramsFrequency(String[] words) {
        Map<String, List<String>> groups = new HashMap<>();

        for (String word : words) {
            int[] freq = new int[26];
            for (char c : word.toLowerCase().toCharArray()) {
                freq[c - 'a']++;
            }
            String key = Arrays.toString(freq);
            groups.computeIfAbsent(key, k -> new ArrayList<>()).add(word);
        }

        return new ArrayList<>(groups.values());
    }

    public static void main(String[] args) {
        String[] words = {"eat", "tea", "tan", "ate", "nat", "bat"};

        System.out.println("Sort-based:");
        groupAnagrams(words).forEach(System.out::println);

        System.out.println("\nFrequency-based:");
        groupAnagramsFrequency(words).forEach(System.out::println);
    }
}
```
</details>

---

### Task 3: Regex-Based Log Parser

Parse structured log lines into objects. Handle different log formats gracefully.

**Format:** `[TIMESTAMP] LEVEL ThreadName - Message`
**Example:** `[2024-01-15T10:30:45.123] INFO main - User login successful`

<details>
<summary>Solution</summary>

```java
import java.util.*;
import java.util.regex.*;
import java.util.stream.*;

public class LogParser {

    private static final Pattern LOG_PATTERN = Pattern.compile(
        "\\[([\\d\\-T:.]+)] (\\w+) (\\S+) - (.+)");

    public record LogEntry(String timestamp, String level, String thread, String message) {
        public static Optional<LogEntry> parse(String line) {
            Matcher m = LOG_PATTERN.matcher(line);
            if (!m.matches()) return Optional.empty();
            return Optional.of(new LogEntry(m.group(1), m.group(2), m.group(3), m.group(4)));
        }
    }

    public static Map<String, Long> countByLevel(List<String> lines) {
        return lines.stream()
            .map(LogEntry::parse)
            .flatMap(Optional::stream)
            .collect(Collectors.groupingBy(LogEntry::level, Collectors.counting()));
    }

    public static List<LogEntry> filterErrors(List<String> lines) {
        return lines.stream()
            .map(LogEntry::parse)
            .flatMap(Optional::stream)
            .filter(e -> "ERROR".equals(e.level()) || "WARN".equals(e.level()))
            .collect(Collectors.toList());
    }

    public static void main(String[] args) {
        List<String> logs = List.of(
            "[2024-01-15T10:30:45.123] INFO main - User login successful",
            "[2024-01-15T10:30:46.456] ERROR pool-1 - Database connection failed",
            "[2024-01-15T10:30:47.789] WARN http-nio - Slow query detected",
            "[2024-01-15T10:30:48.012] INFO main - Request processed",
            "INVALID LINE FORMAT",
            "[2024-01-15T10:30:49.345] ERROR pool-2 - Timeout occurred"
        );

        System.out.println("Counts by level: " + countByLevel(logs));
        // {INFO=2, ERROR=2, WARN=1}

        System.out.println("\nErrors and warnings:");
        filterErrors(logs).forEach(System.out::println);
    }
}
```
</details>

---

## Senior Tasks (2-3)

### Task 1: Thread-Safe String Cache with Eviction

Implement a bounded, thread-safe string cache that:
- Stores canonicalized (deduplicated) strings
- Has a maximum size with LRU eviction
- Provides hit/miss statistics
- Is lock-free for reads

<details>
<summary>Solution</summary>

```java
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public class StringCache {
    private final ConcurrentLinkedDeque<String> accessOrder = new ConcurrentLinkedDeque<>();
    private final ConcurrentHashMap<String, String> cache;
    private final int maxSize;
    private final AtomicLong hits = new AtomicLong();
    private final AtomicLong misses = new AtomicLong();

    public StringCache(int maxSize) {
        this.maxSize = maxSize;
        this.cache = new ConcurrentHashMap<>(maxSize);
    }

    public String canonicalize(String input) {
        if (input == null) return null;

        String cached = cache.get(input);
        if (cached != null) {
            hits.incrementAndGet();
            return cached;
        }

        misses.incrementAndGet();

        // Add to cache
        String previous = cache.putIfAbsent(input, input);
        if (previous != null) {
            return previous; // another thread added it first
        }

        accessOrder.addLast(input);

        // Evict if over capacity
        while (cache.size() > maxSize) {
            String evicted = accessOrder.pollFirst();
            if (evicted != null) {
                cache.remove(evicted);
            }
        }

        return input;
    }

    public double hitRate() {
        long total = hits.get() + misses.get();
        return total == 0 ? 0.0 : (double) hits.get() / total;
    }

    public String stats() {
        return String.format("Size: %d, Hits: %d, Misses: %d, Hit Rate: %.2f%%",
            cache.size(), hits.get(), misses.get(), hitRate() * 100);
    }

    public static void main(String[] args) throws InterruptedException {
        StringCache cache = new StringCache(100);

        // Simulate concurrent usage
        ExecutorService executor = Executors.newFixedThreadPool(4);
        String[] statuses = {"ACTIVE", "PENDING", "INACTIVE", "ERROR", "TIMEOUT"};

        for (int i = 0; i < 10000; i++) {
            final int idx = i;
            executor.submit(() -> {
                String status = statuses[idx % statuses.length];
                String canonical = cache.canonicalize(new String(status)); // force new object
                assert canonical.equals(status);
            });
        }

        executor.shutdown();
        executor.awaitTermination(10, TimeUnit.SECONDS);
        System.out.println(cache.stats());
        // Example: Size: 5, Hits: 9995, Misses: 5, Hit Rate: 99.95%
    }
}
```
</details>

---

### Task 2: High-Performance CSV Writer

Implement a CSV writer that:
- Pre-sizes StringBuilder based on estimated output
- Handles special characters (quotes, commas, newlines) correctly
- Supports streaming output to OutputStream
- Minimizes object allocation

<details>
<summary>Solution</summary>

```java
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

public class HighPerfCsvWriter implements AutoCloseable {
    private final BufferedWriter writer;
    private final StringBuilder lineBuffer;
    private final char delimiter;
    private final char quote;
    private int columnCount = -1;
    private long rowsWritten = 0;

    public HighPerfCsvWriter(OutputStream out, int estimatedColumns) {
        this(out, estimatedColumns, ',', '"');
    }

    public HighPerfCsvWriter(OutputStream out, int estimatedColumns, char delimiter, char quote) {
        this.writer = new BufferedWriter(
            new OutputStreamWriter(out, StandardCharsets.UTF_8), 8192);
        this.lineBuffer = new StringBuilder(estimatedColumns * 20); // ~20 chars per field
        this.delimiter = delimiter;
        this.quote = quote;
    }

    public void writeHeader(String... headers) throws IOException {
        columnCount = headers.length;
        writeRow(headers);
    }

    public void writeRow(String... fields) throws IOException {
        if (columnCount > 0 && fields.length != columnCount) {
            throw new IllegalArgumentException(
                "Expected " + columnCount + " columns, got " + fields.length);
        }

        lineBuffer.setLength(0); // reset without reallocating

        for (int i = 0; i < fields.length; i++) {
            if (i > 0) lineBuffer.append(delimiter);
            appendField(fields[i]);
        }

        writer.append(lineBuffer);
        writer.newLine();
        rowsWritten++;

        if (rowsWritten % 1000 == 0) {
            writer.flush(); // periodic flush for large datasets
        }
    }

    private void appendField(String field) {
        if (field == null) return;

        boolean needsQuoting = false;
        for (int i = 0; i < field.length(); i++) {
            char c = field.charAt(i);
            if (c == delimiter || c == quote || c == '\n' || c == '\r') {
                needsQuoting = true;
                break;
            }
        }

        if (needsQuoting) {
            lineBuffer.append(quote);
            for (int i = 0; i < field.length(); i++) {
                char c = field.charAt(i);
                if (c == quote) lineBuffer.append(quote); // escape quote with double quote
                lineBuffer.append(c);
            }
            lineBuffer.append(quote);
        } else {
            lineBuffer.append(field);
        }
    }

    public long getRowsWritten() { return rowsWritten; }

    @Override
    public void close() throws IOException {
        writer.flush();
        writer.close();
    }

    public static void main(String[] args) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (HighPerfCsvWriter csv = new HighPerfCsvWriter(baos, 3)) {
            csv.writeHeader("Name", "City", "Bio");
            csv.writeRow("Alice", "New York", "Loves \"Java\" programming");
            csv.writeRow("Bob", "San Francisco", "Line 1\nLine 2");
            csv.writeRow("Charlie", "London", "Simple bio");
        }

        System.out.println(baos.toString(StandardCharsets.UTF_8));
        // Name,City,Bio
        // Alice,New York,"Loves ""Java"" programming"
        // Bob,San Francisco,"Line 1
        // Line 2"
        // Charlie,London,Simple bio
    }
}
```
</details>

---

### Task 3: String Similarity Calculator

Implement multiple string similarity algorithms:
1. Levenshtein distance (edit distance)
2. Jaccard similarity (based on character n-grams)
3. Longest Common Subsequence (LCS)

<details>
<summary>Solution</summary>

```java
import java.util.*;
import java.util.stream.*;

public class StringSimilarity {

    // 1. Levenshtein Distance — minimum edit operations
    public static int levenshtein(String a, String b) {
        int[][] dp = new int[a.length() + 1][b.length() + 1];

        for (int i = 0; i <= a.length(); i++) dp[i][0] = i;
        for (int j = 0; j <= b.length(); j++) dp[0][j] = j;

        for (int i = 1; i <= a.length(); i++) {
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                dp[i][j] = Math.min(
                    Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1),
                    dp[i - 1][j - 1] + cost
                );
            }
        }
        return dp[a.length()][b.length()];
    }

    // 2. Jaccard Similarity — based on 2-grams
    public static double jaccard(String a, String b, int n) {
        Set<String> ngramsA = nGrams(a, n);
        Set<String> ngramsB = nGrams(b, n);

        Set<String> intersection = new HashSet<>(ngramsA);
        intersection.retainAll(ngramsB);

        Set<String> union = new HashSet<>(ngramsA);
        union.addAll(ngramsB);

        return union.isEmpty() ? 0.0 : (double) intersection.size() / union.size();
    }

    private static Set<String> nGrams(String s, int n) {
        if (s.length() < n) return Set.of(s);
        return IntStream.rangeClosed(0, s.length() - n)
            .mapToObj(i -> s.substring(i, i + n))
            .collect(Collectors.toSet());
    }

    // 3. Longest Common Subsequence
    public static String lcs(String a, String b) {
        int[][] dp = new int[a.length() + 1][b.length() + 1];

        for (int i = 1; i <= a.length(); i++) {
            for (int j = 1; j <= b.length(); j++) {
                if (a.charAt(i - 1) == b.charAt(j - 1)) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // Backtrack to find the actual subsequence
        StringBuilder result = new StringBuilder();
        int i = a.length(), j = b.length();
        while (i > 0 && j > 0) {
            if (a.charAt(i - 1) == b.charAt(j - 1)) {
                result.append(a.charAt(i - 1));
                i--; j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        return result.reverse().toString();
    }

    public static void main(String[] args) {
        System.out.println("Levenshtein('kitten', 'sitting'): " + levenshtein("kitten", "sitting")); // 3
        System.out.println("Levenshtein('hello', 'hello'): " + levenshtein("hello", "hello"));       // 0

        System.out.printf("Jaccard('night', 'nacht', 2): %.2f%n", jaccard("night", "nacht", 2));     // ~0.14
        System.out.printf("Jaccard('hello', 'hallo', 2): %.2f%n", jaccard("hello", "hallo", 2));     // ~0.50

        System.out.println("LCS('ABCBDAB', 'BDCAB'): " + lcs("ABCBDAB", "BDCAB")); // BCAB
    }
}
```
</details>

---

## Questions (5-10)

1. Why does `"Hello" + " " + "World"` compile to a single string literal but `s + " World"` (where `s` is a variable) does not?

2. What is the difference between `s.split(",")` and `s.split(",", -1)`?

3. Why is `StringBuilder` not thread-safe, and when does that matter?

4. How does `String.hashCode()` work? Can two different strings have the same hash code?

5. What happens when you call `intern()` on a string that is already in the String Pool?

6. Why is `strip()` preferred over `trim()` in Java 11+?

7. How does constant folding optimize string concatenation at compile time?

8. What is the maximum number of characters a Java String can hold?

9. Why does `split(".")` not split by dots? How do you fix it?

10. How would you efficiently count the frequency of each character in a string?

<details>
<summary>Answers</summary>

1. The compiler can only fold **compile-time constants**. Literals are constants, but variables are not — their value is unknown at compile time.

2. `split(",")` removes trailing empty strings from the result array. `split(",", -1)` preserves all empty strings, including trailing ones.

3. StringBuilder's internal `byte[]` and `count` fields are not synchronized. If two threads append simultaneously, they may overwrite each other's data, corrupt the count, or throw `ArrayIndexOutOfBoundsException`.

4. `String.hashCode()` uses the formula `s[0]*31^(n-1) + s[1]*31^(n-2) + ... + s[n-1]`. Yes, different strings can have the same hash code (collision). Example: `"Aa"` and `"BB"` both hash to 2112.

5. If the string is already in the pool, `intern()` simply returns the existing pool reference without creating anything new.

6. `trim()` only removes ASCII whitespace (chars <= `\u0020`). `strip()` removes all Unicode whitespace characters (e.g., em-space, ideographic space).

7. The compiler evaluates expressions involving only constants at compile time. `"Hel" + "lo"` becomes `"Hello"` in the bytecode. This eliminates runtime concatenation overhead.

8. `Integer.MAX_VALUE` (2,147,483,647) characters theoretically. In practice, limited by available heap memory (~4GB for a UTF-16 String).

9. `split()` takes a regex, and `.` means "any character." Fix: `split("\\.")` or `split(Pattern.quote("."))`.

10. Use an `int[128]` array for ASCII, or a `HashMap<Character, Integer>` for Unicode. Stream approach: `s.chars().mapToObj(c -> (char) c).collect(Collectors.groupingBy(c -> c, Collectors.counting()))`.
</details>

---

## Mini Projects (1+)

### Mini Project: Simple Template Engine

Build a template engine that replaces `{{variable}}` placeholders with values from a provided context map. Support:
- Simple variable replacement: `{{name}}`
- Default values: `{{name|default_value}}`
- Conditional blocks: `{{#if condition}}...{{/if}}`

<details>
<summary>Solution</summary>

```java
import java.util.*;
import java.util.regex.*;

public class TemplateEngine {
    private static final Pattern VAR_PATTERN = Pattern.compile("\\{\\{([^}]+)}}");
    private static final Pattern IF_PATTERN = Pattern.compile(
        "\\{\\{#if (\\w+)}}(.*?)\\{\\{/if}}", Pattern.DOTALL);

    public static String render(String template, Map<String, Object> context) {
        // Step 1: Process conditional blocks
        String result = processConditionals(template, context);

        // Step 2: Replace variables
        result = processVariables(result, context);

        return result;
    }

    private static String processConditionals(String template, Map<String, Object> context) {
        Matcher matcher = IF_PATTERN.matcher(template);
        StringBuilder sb = new StringBuilder();

        while (matcher.find()) {
            String condition = matcher.group(1);
            String content = matcher.group(2);

            Object value = context.get(condition);
            boolean truthy = value != null &&
                !Boolean.FALSE.equals(value) &&
                !"".equals(value.toString()) &&
                !"0".equals(value.toString());

            matcher.appendReplacement(sb, Matcher.quoteReplacement(truthy ? content : ""));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    private static String processVariables(String template, Map<String, Object> context) {
        Matcher matcher = VAR_PATTERN.matcher(template);
        StringBuilder sb = new StringBuilder();

        while (matcher.find()) {
            String expression = matcher.group(1).strip();
            String[] parts = expression.split("\\|", 2);
            String varName = parts[0].strip();
            String defaultValue = parts.length > 1 ? parts[1].strip() : "";

            Object value = context.getOrDefault(varName, defaultValue);
            String replacement = value != null ? value.toString() : defaultValue;

            matcher.appendReplacement(sb, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(sb);
        return sb.toString();
    }

    public static void main(String[] args) {
        String template = """
                Hello, {{name|Guest}}!
                {{#if premium}}
                Welcome back, premium member!
                Your balance: ${{balance|0}}
                {{/if}}
                Today's date: {{date}}
                {{greeting|Have a nice day!}}
                """;

        Map<String, Object> context = Map.of(
            "name", "Alice",
            "premium", true,
            "balance", 150.50,
            "date", "2024-01-15"
        );

        System.out.println(render(template, context));
        // Hello, Alice!
        //
        // Welcome back, premium member!
        // Your balance: $150.5
        //
        // Today's date: 2024-01-15
        // Have a nice day!

        System.out.println("---");

        // Without premium flag
        Map<String, Object> basicContext = Map.of("name", "Bob", "date", "2024-01-15");
        System.out.println(render(template, basicContext));
        // Hello, Bob!
        //
        // Today's date: 2024-01-15
        // Have a nice day!
    }
}
```
</details>

---

## Challenge (1)

### Challenge: Implement a Trie-Based Autocomplete System

Build an autocomplete system using a Trie data structure that:
1. Inserts words with frequency counts
2. Returns top-K suggestions for a given prefix, sorted by frequency
3. Supports case-insensitive search
4. Has O(P + K*log(K)) time complexity for suggestions (P = prefix length, K = result count)

**Interface:**
```java
void insert(String word, int frequency);
List<String> suggest(String prefix, int maxResults);
```

<details>
<summary>Solution</summary>

```java
import java.util.*;

public class AutoComplete {

    private static class TrieNode {
        Map<Character, TrieNode> children = new HashMap<>();
        String word = null; // null if not end of word
        int frequency = 0;
    }

    private final TrieNode root = new TrieNode();

    public void insert(String word, int frequency) {
        if (word == null || word.isBlank()) return;
        String lower = word.toLowerCase();

        TrieNode node = root;
        for (char c : lower.toCharArray()) {
            node = node.children.computeIfAbsent(c, k -> new TrieNode());
        }
        node.word = word; // preserve original case
        node.frequency += frequency;
    }

    public List<String> suggest(String prefix, int maxResults) {
        if (prefix == null || prefix.isBlank()) return List.of();

        // Navigate to prefix node
        TrieNode node = root;
        for (char c : prefix.toLowerCase().toCharArray()) {
            node = node.children.get(c);
            if (node == null) return List.of(); // prefix not found
        }

        // Collect all words under this prefix
        PriorityQueue<Map.Entry<String, Integer>> pq =
            new PriorityQueue<>(Comparator.comparingInt(Map.Entry::getValue));

        collectWords(node, pq, maxResults);

        // Convert to sorted list
        List<String> result = new ArrayList<>();
        while (!pq.isEmpty()) {
            result.add(pq.poll().getKey());
        }
        Collections.reverse(result); // highest frequency first
        return result;
    }

    private void collectWords(TrieNode node,
                              PriorityQueue<Map.Entry<String, Integer>> pq,
                              int maxResults) {
        if (node.word != null) {
            pq.offer(Map.entry(node.word, node.frequency));
            if (pq.size() > maxResults) {
                pq.poll(); // remove lowest frequency
            }
        }

        for (TrieNode child : node.children.values()) {
            collectWords(child, pq, maxResults);
        }
    }

    public static void main(String[] args) {
        AutoComplete ac = new AutoComplete();

        // Insert words with frequencies
        ac.insert("java", 100);
        ac.insert("javascript", 90);
        ac.insert("java virtual machine", 50);
        ac.insert("jackson", 30);
        ac.insert("jakarta", 25);
        ac.insert("jar", 80);
        ac.insert("javadoc", 40);
        ac.insert("jaxb", 20);

        System.out.println("Suggestions for 'ja': " + ac.suggest("ja", 5));
        // [java, javascript, jar, java virtual machine, javadoc]

        System.out.println("Suggestions for 'jav': " + ac.suggest("jav", 3));
        // [java, javascript, java virtual machine]

        System.out.println("Suggestions for 'xyz': " + ac.suggest("xyz", 5));
        // []

        System.out.println("Suggestions for 'JAC': " + ac.suggest("JAC", 2));
        // [jackson, jakarta]
    }
}
```
</details>
