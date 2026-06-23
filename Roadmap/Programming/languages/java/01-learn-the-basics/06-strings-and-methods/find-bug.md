# Strings and Methods — Find the Bug

Find and fix the bugs in each code snippet. Each exercise has exactly one or more bugs.

---

## Easy (3)

### Bug 1: String Comparison

```java
public class UserAuth {
    public static boolean authenticate(String inputPassword, String storedPassword) {
        if (inputPassword == storedPassword) {
            return true;
        }
        return false;
    }

    public static void main(String[] args) {
        String stored = "secret123";
        String input = new String("secret123"); // simulating user input
        System.out.println(authenticate(input, stored)); // prints false — why?
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** Using `==` instead of `.equals()` to compare String content. `==` compares references, not values.

**Fixed code:**

```java
public static boolean authenticate(String inputPassword, String storedPassword) {
    if (inputPassword != null && inputPassword.equals(storedPassword)) {
        return true;
    }
    return false;
}
```
</details>

---

### Bug 2: Ignoring Return Value

```java
public class NameFormatter {
    public static String formatName(String name) {
        name.trim();
        name.toLowerCase();
        name.replace(" ", "_");
        return name;
    }

    public static void main(String[] args) {
        System.out.println(formatName("  Alice Smith  "));
        // Expected: "alice_smith"
        // Actual:   "  Alice Smith  "
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** String methods return a new String — the original is not modified (immutability). The return values of `trim()`, `toLowerCase()`, and `replace()` are discarded.

**Fixed code:**

```java
public static String formatName(String name) {
    return name.trim()
               .toLowerCase()
               .replace(" ", "_");
}
```
</details>

---

### Bug 3: Off-By-One in substring

```java
public class Truncator {
    public static String truncate(String text, int maxLength) {
        if (text.length() > maxLength) {
            return text.substring(0, maxLength) + "...";
        }
        return text;
    }

    public static void main(String[] args) {
        System.out.println(truncate(null, 10));        // NullPointerException!
        System.out.println(truncate("Hello", 10));     // Hello
        System.out.println(truncate("Hello World!", 5)); // Hello...
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** No null check — calling `text.length()` on a null reference throws `NullPointerException`.

**Fixed code:**

```java
public static String truncate(String text, int maxLength) {
    if (text == null) return "";
    if (maxLength < 0) throw new IllegalArgumentException("maxLength must be non-negative");
    if (text.length() > maxLength) {
        return text.substring(0, maxLength) + "...";
    }
    return text;
}
```
</details>

---

## Medium (4)

### Bug 4: StringBuilder in Multi-threaded Context

```java
import java.util.concurrent.*;

public class LogCollector {
    private static final StringBuilder log = new StringBuilder();

    public static void addLog(String message) {
        log.append("[").append(Thread.currentThread().getName()).append("] ")
           .append(message).append("\n");
    }

    public static void main(String[] args) throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(10);
        for (int i = 0; i < 1000; i++) {
            final int id = i;
            executor.submit(() -> addLog("Message " + id));
        }
        executor.shutdown();
        executor.awaitTermination(5, TimeUnit.SECONDS);
        System.out.println("Log entries: " + log.toString().split("\n").length);
        // Sometimes throws ArrayIndexOutOfBoundsException!
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** `StringBuilder` is NOT thread-safe. Concurrent `append()` calls from multiple threads can corrupt the internal buffer, causing `ArrayIndexOutOfBoundsException` or data loss.

**Fixed code (Option 1 — StringBuffer):**

```java
private static final StringBuffer log = new StringBuffer();
```

**Fixed code (Option 2 — synchronized, better):**

```java
private static final StringBuilder log = new StringBuilder();
private static final Object lock = new Object();

public static void addLog(String message) {
    String entry = "[" + Thread.currentThread().getName() + "] " + message + "\n";
    synchronized (lock) {
        log.append(entry);
    }
}
```

**Fixed code (Option 3 — collect per-thread, best performance):**

```java
private static final ConcurrentLinkedQueue<String> logs = new ConcurrentLinkedQueue<>();

public static void addLog(String message) {
    logs.add("[" + Thread.currentThread().getName() + "] " + message);
}

public static String collectLogs() {
    return String.join("\n", logs);
}
```
</details>

---

### Bug 5: Regex in split()

```java
public class IpParser {
    public static String[] parseIpAddress(String ip) {
        return ip.split(".");  // supposed to split "192.168.1.1" into ["192", "168", "1", "1"]
    }

    public static void main(String[] args) {
        String[] parts = parseIpAddress("192.168.1.1");
        System.out.println("Parts: " + parts.length);
        // Expected: 4
        // Actual: 0 (empty array!)
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** `split()` takes a regex, and `.` in regex means "any character." So `split(".")` matches every character, resulting in an empty array.

**Fixed code:**

```java
public static String[] parseIpAddress(String ip) {
    return ip.split("\\."); // escape the dot for regex
    // Alternative: ip.split(Pattern.quote("."));
}
```
</details>

---

### Bug 6: String Concatenation Performance

```java
public class ReportGenerator {
    public static String generateReport(List<String> items) {
        String report = "";
        report += "=== Report ===\n";
        report += "Total items: " + items.size() + "\n";
        report += "---\n";

        for (int i = 0; i < items.size(); i++) {
            report += (i + 1) + ". " + items.get(i) + "\n";  // BUG: O(n^2)
        }

        report += "=== End ===\n";
        return report;
    }

    public static void main(String[] args) {
        List<String> items = new java.util.ArrayList<>();
        for (int i = 0; i < 100_000; i++) {
            items.add("Item " + i);
        }

        long start = System.currentTimeMillis();
        String report = generateReport(items);
        long elapsed = System.currentTimeMillis() - start;
        System.out.println("Time: " + elapsed + "ms"); // ~10,000+ ms!
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** Using `+=` for string concatenation inside a loop creates O(N^2) time complexity. Each `+=` creates a new String and copies all previous content.

**Fixed code:**

```java
public static String generateReport(List<String> items) {
    StringBuilder report = new StringBuilder(items.size() * 30); // pre-size
    report.append("=== Report ===\n");
    report.append("Total items: ").append(items.size()).append("\n");
    report.append("---\n");

    for (int i = 0; i < items.size(); i++) {
        report.append(i + 1).append(". ").append(items.get(i)).append("\n");
    }

    report.append("=== End ===\n");
    return report.toString();
}
// Now runs in ~5ms instead of ~10,000ms
```
</details>

---

### Bug 7: Case-Sensitive Contains Check

```java
public class SearchFilter {
    public static List<String> search(List<String> items, String query) {
        List<String> results = new java.util.ArrayList<>();
        for (String item : items) {
            if (item.contains(query)) {
                results.add(item);
            }
        }
        return results;
    }

    public static void main(String[] args) {
        List<String> products = List.of("Java Programming", "JAVA Basics", "javascript Guide");
        List<String> results = search(products, "java");
        System.out.println(results);
        // Expected: [Java Programming, JAVA Basics, javascript Guide]
        // Actual:   [javascript Guide]  — only lowercase match!
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** `contains()` is case-sensitive. "java" does not match "Java" or "JAVA".

**Fixed code:**

```java
public static List<String> search(List<String> items, String query) {
    String lowerQuery = query.toLowerCase();
    List<String> results = new java.util.ArrayList<>();
    for (String item : items) {
        if (item.toLowerCase().contains(lowerQuery)) {
            results.add(item);
        }
    }
    return results;
}
```
</details>

---

## Hard (3)

### Bug 8: Memory Leak via String References

```java
import java.util.*;

public class MessageCache {
    private static final Map<String, String> cache = new HashMap<>();

    public static void cacheMessage(String rawMessage) {
        // Extract first 10 chars as key
        String key = rawMessage.substring(0, 10);
        cache.put(key, rawMessage);
    }

    public static void main(String[] args) {
        // Simulate receiving 1MB messages
        for (int i = 0; i < 10000; i++) {
            String largeMessage = "MSG_" + String.format("%06d", i) + "_"
                + "x".repeat(1_000_000); // 1MB message
            cacheMessage(largeMessage);
        }
        // Expected: cache holds 10,000 entries with short keys and long values
        // Bug: All 10,000 full 1MB messages are retained!
        // Even though we only need a 10-char key, the full message is stored as value
        System.out.println("Cache size: " + cache.size());
        // OutOfMemoryError likely!
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** The cache stores the entire `rawMessage` as the value, not just the relevant part. The code stores both the 10-char key AND the full 1MB message string. If only the key is needed, the values waste memory.

Additionally, in pre-Java 7u6, `substring()` shared the backing array with the parent string, meaning even the "short" key would retain the entire 1MB parent. In modern Java, `substring()` creates a new array, so the key is truly short — but the value is still the full message.

**Fixed code (if only keys are needed):**

```java
public static void cacheMessage(String rawMessage) {
    String key = rawMessage.substring(0, 10);
    // Store only what's needed, not the full message
    String summary = rawMessage.substring(0, Math.min(100, rawMessage.length()));
    cache.put(key, summary);
}
```

**Fixed code (if bounded cache is needed):**

```java
private static final int MAX_CACHE_SIZE = 1000;
private static final Map<String, String> cache = new LinkedHashMap<>(16, 0.75f, true) {
    @Override
    protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
        return size() > MAX_CACHE_SIZE;
    }
};
```
</details>

---

### Bug 9: Unicode Surrogate Pair Handling

```java
public class EmojiCounter {
    public static int countCharacters(String text) {
        return text.length(); // BUG: wrong for emoji and supplementary characters!
    }

    public static String truncateToChars(String text, int maxChars) {
        if (text.length() <= maxChars) return text;
        return text.substring(0, maxChars) + "..."; // BUG: may split a surrogate pair!
    }

    public static void main(String[] args) {
        String emoji = "Hello \uD83D\uDE00\uD83D\uDE01\uD83D\uDE02"; // Hello + 3 emoji
        System.out.println("Characters: " + countCharacters(emoji));
        // Expected: 9 (5 letters + space + 3 emoji)
        // Actual: 12 (each emoji = 2 chars in UTF-16)

        System.out.println("Truncated: " + truncateToChars(emoji, 7));
        // May produce broken output with half a surrogate pair
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** `String.length()` returns the number of `char` values (UTF-16 code units), not the number of visible characters. Emoji and many non-BMP characters use surrogate pairs (2 chars each). `substring()` can split a surrogate pair, producing invalid characters.

**Fixed code:**

```java
public static int countCharacters(String text) {
    return text.codePointCount(0, text.length());
}

public static String truncateToChars(String text, int maxCodePoints) {
    int actualPoints = text.codePointCount(0, text.length());
    if (actualPoints <= maxCodePoints) return text;

    int endIndex = text.offsetByCodePoints(0, maxCodePoints);
    return text.substring(0, endIndex) + "...";
}

public static void main(String[] args) {
    String emoji = "Hello \uD83D\uDE00\uD83D\uDE01\uD83D\uDE02";
    System.out.println("Characters: " + countCharacters(emoji)); // 9
    System.out.println("Truncated: " + truncateToChars(emoji, 7)); // Hello 😀...
}
```
</details>

---

### Bug 10: ReDoS Vulnerability

```java
public class InputValidator {
    public static boolean isValidEmail(String email) {
        // Complex regex — vulnerable to ReDoS!
        return email.matches("^([a-zA-Z0-9]+\\.?)+@([a-zA-Z0-9]+\\.?)+$");
    }

    public static void main(String[] args) {
        // Normal inputs work fine
        System.out.println(isValidEmail("user@example.com")); // true

        // Malicious input — causes catastrophic backtracking
        String malicious = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@";
        long start = System.nanoTime();
        System.out.println(isValidEmail(malicious)); // hangs for minutes!
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Time: " + elapsed + "ms");
    }
}
```

<details>
<summary>Bug & Fix</summary>

**Bug:** The regex `([a-zA-Z0-9]+\\.?)+` has nested quantifiers (`+` inside `+`), causing **catastrophic backtracking** (exponential time complexity). For a 30-character input that fails to match, the regex engine explores billions of possibilities.

**Fixed code:**

```java
import java.util.regex.Pattern;

public class InputValidator {
    // Pre-compiled, non-vulnerable pattern
    private static final Pattern EMAIL_PATTERN = Pattern.compile(
        "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
    );

    public static boolean isValidEmail(String email) {
        if (email == null || email.length() > 254) return false; // RFC 5321 max length
        return EMAIL_PATTERN.matcher(email).matches();
    }

    public static void main(String[] args) {
        System.out.println(isValidEmail("user@example.com"));       // true
        String malicious = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa@";
        long start = System.nanoTime();
        System.out.println(isValidEmail(malicious));                 // false (instant)
        long elapsed = (System.nanoTime() - start) / 1_000_000;
        System.out.println("Time: " + elapsed + "ms");              // ~0ms
    }
}
```

**Key fixes:**
1. Removed nested quantifiers (`(a+)+` pattern)
2. Pre-compiled the Pattern
3. Added input length validation
</details>

---

## Score Card

| # | Difficulty | Bug Type | Found? | Fixed? |
|---|-----------|----------|--------|--------|
| 1 | Easy | `==` vs `.equals()` | [ ] | [ ] |
| 2 | Easy | Ignoring immutable return value | [ ] | [ ] |
| 3 | Easy | Missing null check | [ ] | [ ] |
| 4 | Medium | Thread-unsafe StringBuilder | [ ] | [ ] |
| 5 | Medium | Unescaped regex in split() | [ ] | [ ] |
| 6 | Medium | O(n^2) string concatenation | [ ] | [ ] |
| 7 | Medium | Case-sensitive comparison | [ ] | [ ] |
| 8 | Hard | Memory leak via String retention | [ ] | [ ] |
| 9 | Hard | Unicode surrogate pair corruption | [ ] | [ ] |
| 10 | Hard | ReDoS vulnerability | [ ] | [ ] |

### Scoring

- **9-10 found + fixed:** Expert level — you understand String internals deeply
- **7-8 found + fixed:** Advanced — solid understanding, review edge cases
- **5-6 found + fixed:** Intermediate — good foundation, study concurrency and Unicode
- **< 5 found + fixed:** Beginner — review String basics and common pitfalls
