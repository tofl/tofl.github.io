---
title: "DynamoDB Update Expressions Explained: SET, REMOVE, ADD, and DELETE"
---

## DynamoDB Update Expressions Explained: SET, REMOVE, ADD, and DELETE

When you need to modify an item in DynamoDB without replacing the entire record, the UpdateItem operation is your go-to tool. But UpdateItem's real power lies in update expressions—a specialized syntax that lets you precisely control how data changes. If you've ever found yourself struggling to increment a counter, append to a list, or update a deeply nested attribute, you'll quickly appreciate how update expressions transform what could be a multi-step operation into a single, atomic action.

In this article, we'll explore the four fundamental action clauses of DynamoDB update expressions: SET, REMOVE, ADD, and DELETE. You'll learn not just the syntax, but the practical patterns and trade-offs that make each one valuable in real applications. By the end, you'll be able to write efficient, expressive update expressions that handle everything from simple counter increments to complex nested document transformations.

### Understanding Update Expressions at a Glance

Before diving into each action clause, let's establish what update expressions actually do. An update expression is a string that defines how you want to modify an item. It's separate from the item's actual data—instead, you pass it to the UpdateItem API call along with the item's key. DynamoDB parses the expression, applies the changes atomically, and returns either the updated item or a confirmation of success.

The beauty of this approach is atomicity. If your application crashes mid-operation, DynamoDB hasn't left your data in a partially-updated state. Either the entire expression succeeds or it fails. This is especially important for operations like incrementing counters or managing sets, where consistency is critical.

An update expression can contain one or more action clauses, and they're not mutually exclusive. A single expression might SET some attributes, REMOVE others, ADD to a counter, and DELETE from a set—all in one atomic operation. This flexibility means fewer round-trips to the database and cleaner, more maintainable application code.

### The SET Action: Assignment and Arithmetic

The SET action is the workhorse of update expressions. It adds, updates, or overwrites attributes on an item. Most of the time, when you're modifying data in DynamoDB, you're using SET.

The basic syntax is straightforward: `SET attribute_name = value`. When you execute this, if the attribute doesn't exist, DynamoDB creates it. If it does exist, the new value replaces it entirely. This makes SET useful for simple assignments, but its true strength emerges when you combine it with functions and expressions.

Let's say you're building a user profile system and need to update a user's email address. The expression would be:

```
SET email = :email_val
```

You'd pass `:email_val` as an attribute value in your request, keeping data separate from the expression syntax. This separation protects against injection issues and makes expressions cleaner.

But SET can do much more. You can perform arithmetic operations within the SET clause using the addition operator. This is how you implement atomic counters in DynamoDB:

```
SET login_count = login_count + :increment
```

If `login_count` currently holds the value 5 and you pass `:increment` as 1, the result will be 6. The critical part is that this happens atomically—no race conditions, no lost updates. Multiple concurrent requests incrementing the same counter will each safely increase it by their specified amount.

Atomic counters are invaluable for tracking metrics like page views, API call counts, or login attempts. Without the SET action's arithmetic capability, you'd need to read the current value, increment it in your application, and write it back—a process that's both slower and vulnerable to lost updates.

You can also use SET to update multiple attributes in a single expression by separating them with commas:

```
SET email = :email_val, last_login = :now, login_count = login_count + :increment
```

Another powerful SET feature is the ability to build or modify nested structures. DynamoDB's document model supports maps (which are like objects or dictionaries), and you can use dot notation to access nested attributes. For example:

```
SET profile.bio = :bio_text, profile.avatar_url = :avatar
```

This expression updates the `bio` and `avatar_url` fields within a nested `profile` map. If the `profile` map doesn't exist, DynamoDB creates it. If it exists, these fields are added or updated within it. This allows you to evolve your schema without migrations—add new nested fields whenever your application needs them.

The SET action also includes a few handy functions. The `if_not_exists()` function is particularly useful for conditional updates. Suppose you want to initialize a field only if it doesn't already have a value:

```
SET view_count = if_not_exists(view_count, :zero)
```

If `view_count` already exists on the item, it's left untouched. If it doesn't exist, it's set to the value of `:zero`. This pattern is useful during migrations or when you're gradually introducing new attributes to existing items.

You can also use SET with the `list_append()` function to add elements to the end of a list without needing to fetch the entire list first. We'll explore this in more detail when we discuss list operations, but the core idea is that you're appending data atomically within a single expression.

### The REMOVE Action: Deleting Attributes

While SET adds or modifies, REMOVE does the opposite—it deletes attributes from an item. This might seem simple, and in basic cases it is, but REMOVE is essential for maintaining clean data and managing schemas that evolve over time.

The syntax is minimal: `REMOVE attribute_name`. To remove multiple attributes, separate them with commas:

```
REMOVE deprecated_field, old_config, temp_value
```

This removes three attributes from the item in a single atomic operation. If an attribute doesn't exist, REMOVE simply ignores it—no error is raised. This idempotent behavior makes REMOVE safe to use even when you're not certain whether an attribute is present.

You can also use REMOVE with nested attributes using dot notation:

```
REMOVE profile.bio, settings.notifications.email
```

This removes specific fields from nested maps without affecting the maps themselves (unless those fields are the only ones in the map, in which case the empty maps are left behind). This is useful when you're cleaning up deprecated nested configuration or removing personal information for privacy compliance.

One common use case is archiving or anonymizing data. Rather than deleting an entire item, you might remove sensitive personal information:

```
REMOVE phone_number, social_security_number, credit_card_last_four
```

Another practical scenario is managing schema evolution. As your application matures, some attributes become obsolete. Gradually removing them from items (perhaps through a background job that targets old items) keeps your data tidy and ensures new code isn't confused by legacy fields.

You can even combine REMOVE with other actions in a single expression. For instance, you might want to update a user's status to "archived" and simultaneously remove their contact information:

```
SET #status = :archived_status REMOVE phone_number, email_address
```

(Note the use of `#status`—this is an expression attribute name placeholder, necessary because "status" can be a reserved word in DynamoDB.)

### The ADD Action: Atomic Counters and Set Operations

The ADD action serves two distinct purposes in DynamoDB, and understanding which one applies in your situation is key to using it effectively.

First, ADD works with numbers, much like SET with arithmetic. But ADD has different semantics. If the attribute doesn't exist, ADD creates it and initializes it with the value you specify. If it does exist, ADD increments it by that value. This makes ADD especially clean for counter initialization:

```
ADD visit_count :one
```

If `visit_count` doesn't exist, it's set to 1. On subsequent calls with the same expression, it increments: 1, 2, 3, and so on. Compare this to SET with arithmetic, which would fail if the attribute doesn't exist (unless you wrap it in `if_not_exists()`). In practice, both approaches work; ADD is just more ergonomic when you're initializing counters from zero.

The second use of ADD applies to sets, a fundamental DynamoDB data type. Sets are collections of unique values—either numbers, strings, or binary data. Unlike lists, sets are unordered and automatically deduplicate. ADD lets you add elements to a set atomically:

```
ADD tags :new_tags
```

If you pass `:new_tags` as a set containing `{"python", "aws"}`, these values are added to the `tags` attribute. If the attribute doesn't exist, it's created with these values. If it does exist and already contains one of these values, the set still contains only one copy (sets enforce uniqueness). If it exists and doesn't contain these values, they're added.

Sets are excellent for use cases like tracking user interests, permissions, or any scenario where you need a dynamic collection of unique items without caring about order. The ADD action lets you modify them without fetching the current set first—perfect for asynchronous or concurrent operations.

Here's a practical example: tracking which features a user has enabled. Rather than storing a list and checking for duplicates, you use a set:

```
ADD enabled_features :new_features
```

Pass `:new_features` as `{"feature_dark_mode", "feature_two_factor_auth"}`, and these are atomically added to the user's enabled features. Even if multiple requests execute this expression simultaneously with overlapping features, the set will contain each feature exactly once.

One important caveat: ADD only works with number and set types. It cannot be used with strings, lists, or maps. If you need to add elements to a list, you'll use SET with `list_append()` instead.

### The DELETE Action: Removing Elements from Sets

DELETE is the complement to ADD for sets. While ADD puts elements into a set, DELETE removes specific elements from it.

The syntax mirrors ADD:

```
DELETE tags :tags_to_remove
```

If you pass `:tags_to_remove` as a set containing `{"deprecated", "archived"}`, these values are removed from the `tags` attribute if they exist. Like ADD, DELETE is idempotent—if an element isn't in the set, DELETE simply doesn't remove it. If the set becomes empty after deletion, DynamoDB removes the attribute entirely.

DELETE is invaluable for permission revocation, feature flag toggling, or any scenario where you need to remove items from a set without managing the entire set in your application logic.

Imagine tracking user roles: a user might have `{"admin", "editor", "viewer"}`. When you need to revoke the admin role, you simply use:

```
DELETE user_roles :admin_role
```

Pass `:admin_role` as `{"admin"}`, and it's removed from the set. The user retains `{"editor", "viewer"}`. This is far cleaner than fetching the entire set, filtering it in your application, and writing it back.

Like ADD, DELETE only works with sets. If you try to use it with any other data type, DynamoDB returns a validation error.

### Updating Lists: Append and Index-Based Removal

Lists in DynamoDB are ordered collections that can contain mixed types. Unlike sets, lists can have duplicate values and preserve order, making them suitable for sequences, historical records, or ordered collections.

Appending to a list is done using the `list_append()` function within a SET action:

```
SET comments = list_append(comments, :new_comments)
```

Pass `:new_comments` as a list, and its elements are appended to the end of the `comments` list. If `comments` doesn't exist, it's created with the new elements. If it does exist, the new elements are added to the end while preserving existing elements and their order.

This is particularly useful for append-only data structures like activity feeds, comment threads, or audit logs. Each update appends new records without modifying existing ones.

You can also prepend by swapping the order in `list_append()`:

```
SET comments = list_append(:new_comments, comments)
```

Now the new comments appear at the start of the list.

For removing elements from a list, DynamoDB's approach is different. You cannot directly reference elements by value; instead, you specify them by index. This is done using SET with the index notation:

```
REMOVE comments[0], comments[2]
```

This removes the first and third elements from the list. Be aware that indices are zero-based and are evaluated at the time of the update. If you remove index 0, subsequent elements shift down—index 1 becomes index 0. If you're removing multiple indices, remove them from highest to lowest to avoid index shifting issues.

In practice, removing specific list elements by index is less common than appending. Lists are often used for sequences where you append new data rather than surgically modify existing entries. When you do need to remove elements, consider whether a set might better suit your use case if order doesn't matter.

### Combining Multiple Actions in a Single Expression

The real power of update expressions emerges when you combine multiple action clauses. A single expression can SET attributes, REMOVE others, ADD to a counter, and DELETE from a set—all atomically.

Consider a scenario where you're processing a user action: a user enables a new feature, so you want to add it to their enabled features set, increment a feature adoption counter, set the last updated timestamp, and remove any legacy "early access" tag if it exists:

```
SET enabled_features = list_append(enabled_features, :new_feature), 
    #timestamp = :now, 
    feature_adoption_count = feature_adoption_count + :one
ADD feature_enabled_count :one
DELETE legacy_tags :early_access
```

All of this happens in a single atomic operation. If any part fails validation, the entire operation fails and the item is unchanged. If it succeeds, all changes apply together.

When writing complex expressions, readability matters. Break lines logically, use consistent indentation, and ensure your placeholder names (like `:new_feature`, `:now`) are self-documenting. This makes maintenance easier, especially when expressions grow complicated.

One other consideration: the order of action clauses in the expression doesn't affect the result, but conventionally people write SET, then ADD, then REMOVE, then DELETE. This convention aids readability across teams.

### Practical Patterns and Best Practices

Now that we've covered the mechanics, let's explore patterns that solve real problems.

**The Atomic Counter Pattern** is perhaps the most valuable. Rather than reading a counter value, incrementing it in your application, and writing it back, use SET or ADD:

```
SET view_count = view_count + :increment
```

This is ideal for any metric: page views, API calls, failed login attempts, or inventory counts. The atomicity guarantees that no updates are lost, even under high concurrency.

**Conditional Initialization** uses `if_not_exists()` to safely initialize attributes:

```
SET created_at = if_not_exists(created_at, :now)
```

The first time this runs, `created_at` is set. On subsequent updates, it's left untouched. This is useful when migrating existing items to add new required fields.

**Append-Only Logs** leverage `list_append()` for immutable history:

```
SET audit_log = list_append(audit_log, :new_entry)
```

Each update appends a new audit record. The list grows indefinitely, which is suitable for compliance and debugging but may need archival strategies for very large histories.

**Permission and Feature Management** use ADD and DELETE on sets:

```
ADD user_permissions :new_perms
DELETE user_permissions :revoked_perms
```

This approach scales well because sets are optimized for membership operations and don't require fetching the entire set before modifying it.

**Expiration with TTL** is a DynamoDB feature, not an update expression feature, but it works well in concert: set a TTL attribute to a future Unix timestamp, and DynamoDB automatically deletes the item when that time arrives. You can update the TTL attribute with a SET action when you want to extend expiration.

### Expression Attribute Names and Values

Before wrapping up, a brief note on expression attribute names and values, which are essential when writing robust update expressions.

Expression attribute values (like `:now`, `:increment`) are placeholders for actual data. This separates your expression logic from your data, protecting against injection-style vulnerabilities. Always use placeholders for user-provided data or dynamic values:

```
SET email = :email_val
```

Expression attribute names (like `#timestamp`, `#status`) are placeholders for attribute names. Use them when your attribute name is a reserved word in DynamoDB or when it contains special characters:

```
SET #status = :new_status
```

DynamoDB's list of reserved words is extensive—words like "status", "data", "time", and "value" are reserved. Rather than remembering the list, it's safe practice to use expression attribute names for any user-defined fields in production code.

### Conclusion

Update expressions are central to writing efficient DynamoDB applications. SET handles assignment and arithmetic, giving you atomic counters and the ability to modify nested structures. REMOVE cleans up attributes and supports schema evolution. ADD initializes counters and adds elements to sets. DELETE removes elements from sets. Together, these four actions provide a complete, atomic toolkit for item modification.

The key insight is that these operations happen atomically at the database level, eliminating race conditions and the need for read-modify-write cycles. Whether you're incrementing a counter, appending to a log, managing permissions through sets, or updating nested user profiles, update expressions let you express your intent clearly while letting DynamoDB handle the complexity.

Start simple—use SET for basic updates. As your needs grow, add atomic counters with ADD, manage sets with ADD and DELETE, and layer in complexity with nested attributes and conditional logic. The syntax is approachable, and the performance and correctness benefits are substantial.
