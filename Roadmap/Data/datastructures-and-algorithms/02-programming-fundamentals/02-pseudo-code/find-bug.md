# Pseudo Code — Find the Bug

> 10+ exercises. Each shows buggy pseudo code — find, explain, and show the fix.

---

## Exercise 1: Off-by-One in Loop Bounds

### Buggy Pseudo Code

```text
FUNCTION sumArray(array)
    SET sum = 0
    FOR i = 0 TO length(array) DO     // BUG
        SET sum = sum + array[i]
    END FOR
    RETURN sum
END FUNCTION
```

**Bug:** `FOR i = 0 TO length(array)` goes one past the last index → index out of bounds.

**Fix:**

```text
FOR i = 0 TO length(array) - 1 DO
```

---

## Exercise 2: Missing Base Case in Recursion

### Buggy Pseudo Code

```text
FUNCTION power(base, exp)
    RETURN base * CALL power(base, exp - 1)     // BUG: no base case
END FUNCTION
```

**Bug:** No base case → infinite recursion → stack overflow.

**Fix:**

```text
FUNCTION power(base, exp)
    IF exp == 0 THEN
        RETURN 1
    END IF
    RETURN base * CALL power(base, exp - 1)
END FUNCTION
```

---

## Exercise 3: Wrong Variable Updated

### Buggy Pseudo Code

```text
FUNCTION findMin(array)
    SET min = array[0]
    FOR i = 1 TO length(array) - 1 DO
        IF array[i] < min THEN
            SET min = i                // BUG: should be array[i], not i
        END IF
    END FOR
    RETURN min
END FUNCTION
```

**Bug:** Storing the index `i` instead of the value `array[i]`.

**Fix:**

```text
SET min = array[i]
```

---

## Exercise 4: Condition Never True

### Buggy Pseudo Code

```text
FUNCTION linearSearch(array, target)
    FOR i = 0 TO length(array) - 1 DO
        IF array[i] = target THEN        // BUG: assignment, not comparison
            RETURN i
        END IF
    END FOR
    RETURN -1
END FUNCTION
```

**Bug:** Single `=` is ambiguous — could be interpreted as assignment. In pseudo code, always use `==` for comparison.

**Fix:**

```text
IF array[i] == target THEN
```

---

## Exercise 5: Wrong Loop Direction

### Buggy Pseudo Code

```text
FUNCTION reverseArray(array)
    SET result = empty array
    FOR i = 0 TO length(array) - 1 DO       // BUG: iterates forward, not reverse
        APPEND array[i] TO result
    END FOR
    RETURN result
END FUNCTION
```

**Bug:** Iterating forward creates a copy, not a reverse.

**Fix:**

```text
FOR i = length(array) - 1 DOWNTO 0 DO
    APPEND array[i] TO result
END FOR
```

---

## Exercise 6: Infinite Loop

### Buggy Pseudo Code

```text
FUNCTION countDown(n)
    WHILE n > 0 DO
        PRINT n
        // BUG: forgot to decrement n
    END WHILE
END FUNCTION
```

**Bug:** `n` is never decremented → infinite loop.

**Fix:**

```text
WHILE n > 0 DO
    PRINT n
    SET n = n - 1
END WHILE
```

---

## Exercise 7: Wrong Return Position

### Buggy Pseudo Code

```text
FUNCTION hasNegative(array)
    FOR i = 0 TO length(array) - 1 DO
        IF array[i] < 0 THEN
            RETURN true
        ELSE
            RETURN false          // BUG: returns false on first non-negative
        END IF
    END FOR
END FUNCTION
```

**Bug:** Returns `false` immediately when the first element is not negative, without checking the rest.

**Fix:**

```text
FUNCTION hasNegative(array)
    FOR i = 0 TO length(array) - 1 DO
        IF array[i] < 0 THEN
            RETURN true
        END IF
    END FOR
    RETURN false                  // only return false after checking ALL elements
END FUNCTION
```

---

## Exercise 8: Wrong Merge Logic

### Buggy Pseudo Code

```text
FUNCTION merge(left, right)
    SET result = empty array
    SET i = 0, j = 0
    WHILE i < length(left) AND j < length(right) DO
        IF left[i] < right[j] THEN
            APPEND left[i] TO result
            SET i = i + 1
        ELSE
            APPEND right[j] TO result
            SET j = j + 1
        END IF
    END WHILE
    RETURN result           // BUG: remaining elements not appended!
END FUNCTION
```

**Bug:** After the while loop, one of the arrays may still have elements. They're lost.

**Fix:**

```text
    END WHILE
    WHILE i < length(left) DO
        APPEND left[i] TO result
        SET i = i + 1
    END WHILE
    WHILE j < length(right) DO
        APPEND right[j] TO result
        SET j = j + 1
    END WHILE
    RETURN result
```

---

## Exercise 9: Binary Search Wrong Mid Update

### Buggy Pseudo Code

```text
FUNCTION binarySearch(array, target)
    SET left = 0
    SET right = length(array) - 1
    WHILE left <= right DO
        SET mid = (left + right) / 2
        IF array[mid] == target THEN
            RETURN mid
        ELSE IF array[mid] < target THEN
            SET left = mid              // BUG: should be mid + 1
        ELSE
            SET right = mid             // BUG: should be mid - 1
        END IF
    END WHILE
    RETURN -1
END FUNCTION
```

**Bug:** Not moving past `mid` → infinite loop when `array[mid] != target`.

**Fix:**

```text
SET left = mid + 1    // move past mid when searching right
SET right = mid - 1   // move past mid when searching left
```

---

## Exercise 10: Swap Without Temp

### Buggy Pseudo Code

```text
FUNCTION swap(a, b)
    SET a = b        // BUG: original a is lost!
    SET b = a        // b gets the new a (which is b) — no swap happened
END FUNCTION
```

**Bug:** Overwriting `a` first means the original value of `a` is lost.

**Fix:**

```text
FUNCTION swap(a, b)
    SET temp = a
    SET a = b
    SET b = temp
END FUNCTION
```

---

## Exercise 11: Missing Edge Case Check

### Buggy Pseudo Code

```text
FUNCTION average(array)
    SET sum = 0
    FOR each item IN array DO
        SET sum = sum + item
    END FOR
    RETURN sum / length(array)    // BUG: division by zero if array is empty
END FUNCTION
```

**Bug:** If `array` is empty, `length(array) = 0` → division by zero.

**Fix:**

```text
FUNCTION average(array)
    IF length(array) == 0 THEN
        RETURN 0   // or error
    END IF
    SET sum = 0
    FOR each item IN array DO
        SET sum = sum + item
    END FOR
    RETURN sum / length(array)
END FUNCTION
```
