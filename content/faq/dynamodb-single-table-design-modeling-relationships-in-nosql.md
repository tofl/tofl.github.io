---
title: "DynamoDB Single-Table Design: Modeling Relationships in NoSQL"
---

## DynamoDB Single-Table Design: Modeling Relationships in NoSQL

When you're building applications with AWS DynamoDB, you might feel an instinctive pull toward the relational database mindset you've known for years. Create a users table, an orders table, an order_items table—each with its own primary key, all neatly normalized. It feels comfortable. It feels right.

But DynamoDB isn't SQL, and applying relational patterns to a NoSQL database often leads to architectural pain: query latency creeping upward, API calls multiplying, costs ballooning. AWS architects have long recommended a fundamentally different approach called single-table design, and understanding this pattern is essential for building efficient, scalable DynamoDB applications.

This article walks you through the philosophy, mechanics, and practical implementation of single-table design. We'll explore why this approach works, how to model complex relationships without normalization, and how to structure your schema to support multiple access patterns from a single table. By the end, you'll understand not just what single-table design is, but why it produces better DynamoDB applications.

### Why Single-Table Design Matters in DynamoDB

To understand single-table design, you first need to appreciate how DynamoDB differs fundamentally from relational databases. SQL databases optimize for *normalized* schemas where data is split across tables to eliminate redundancy. The database engine handles joins—potentially expensive operations—transparently. You query logically; the database figures out the physical execution.

DynamoDB optimizes for something else entirely: **fast, predictable access to items using their primary key**. When you ask DynamoDB for an item, it uses your partition key to locate the right partition, then uses the sort key to pinpoint the exact item. This operation is O(1)—blazingly fast, whether your table holds a thousand items or a billion. But anything that requires scanning multiple items or reconstructing relationships becomes expensive in terms of latency and cost.

The relational instinct creates a problem: if you split your data across multiple tables, reconstructing a user's order history requires fetching the user item, then querying the orders table, then potentially querying order_items in a third table. Each API call has latency. Each API call costs. And under high concurrency, these extra round trips become a bottleneck.

Single-table design flips this on its head. Instead of normalizing data across tables, you store multiple entity types in a single table using clever key design. A user, their orders, and order items all coexist in one table, accessed through carefully crafted queries. This approach requires upfront thinking—you design around your *access patterns* rather than your data model—but it rewards you with efficiency, lower latency, and dramatically reduced API calls.

### The Access Pattern First Mindset

Before you design a single table, you must explicitly enumerate how your application will access the data. This is genuinely different from relational database design, where you often normalize first and optimize queries later.

Consider a simple e-commerce domain. You might need to support these access patterns:

- Fetch a user by user ID
- Get all orders for a specific user
- Fetch a specific order and all its items
- Find all orders placed on a given date
- List all orders for a user within a date range

Notice how each pattern defines a specific query shape. The first pattern needs only a user ID. The second needs a user ID and can return multiple results. The fourth needs a date. The fifth needs both a user ID and a date range.

In a relational database, you'd normalize once and these queries would work naturally through joins. In DynamoDB, each pattern potentially needs its own key structure. You can't support all patterns efficiently with a single set of keys—instead, you'll use primary keys for your most critical patterns and secondary indexes for others.

This is why access patterns come *before* schema design. Write them down. Discuss them with your team. Understand their relative importance. Only then do you start modeling the table structure.

### Composite Keys: The Foundation of Single-Table Design

The magic of single-table design relies on DynamoDB's support for composite primary keys—a partition key and an optional sort key. The partition key determines which partition stores the item; the sort key orders items within that partition.

In single-table design, you overload these keys to hold different meanings depending on the entity type. This is the core technique.

Consider our e-commerce example. A typical single-table design might use:

- **Partition Key (PK):** An entity identifier that groups related items. For our example, this might be `USER#<userId>` for user items, `USER#<userId>` for order items belonging to that user, and so on.
- **Sort Key (SK):** An entity type and secondary identifier that distinguishes different record types and orders them meaningfully. For our example, this might be `PROFILE#<userId>` for the user profile itself, `ORDER#<orderId>` for an order, `ORDERITEM#<orderItemId>` for items within an order.

With this structure, here's what the table might hold:

```
PK              SK                           Attributes
USER#123        PROFILE#123                  name, email, created_at, ...
USER#123        ORDER#456                    order_id, total, created_at, ...
USER#123        ORDER#456#ITEM#001           product_id, quantity, price, ...
USER#123        ORDER#457                    order_id, total, created_at, ...
USER#456        PROFILE#456                  name, email, created_at, ...
USER#456        ORDER#789                    order_id, total, created_at, ...
```

Notice how the partition key groups all data for a user together. The sort key distinguishes between the profile, individual orders, and order items. This design enables elegant queries:

- Fetch user profile: Query with `PK = USER#123 AND SK = PROFILE#123`
- Get all orders for a user: Query with `PK = USER#123 AND SK begins_with ORDER#`
- Get a specific order and all its items: Query with `PK = USER#123 AND SK begins_with ORDER#456`

All these queries hit a single partition. All happen in one or two API calls instead of multiple round trips.

### Naming Conventions for Keys

The example above uses a simple naming convention: `ENTITY#identifier`. This convention is popular in the DynamoDB community for good reasons.

The pattern `TYPE#VALUE` makes keys self-documenting and scannable. When you're debugging or examining table contents, seeing `USER#123` immediately tells you what entity type and ID you're looking at. Similarly, `ORDER#456#ITEM#001` clearly indicates an order item.

Some practitioners prefer variations like `USER|123` or `user-123`, but the hash-prefixed approach has become idiomatic in the DynamoDB ecosystem. It's visually distinct, easy to parse in code, and aligns with how many open-source tools and educational materials format keys.

For partition and sort key naming at the table level, many teams use generic names like `pk` and `sk` (or `PK` and `SK`). This might seem counterintuitive at first—after all, the keys mean different things in different contexts—but it's pragmatic. Your generic `pk` and `sk` don't constrain the values they hold. A single `pk` can represent a user, a product, a store, or anything else depending on how you format the value itself. This flexibility is exactly what single-table design needs.

An alternative is to name keys more specifically, like `entityKey` and `sortKey`, or `id` and `timestamp`. The important thing is consistency within your codebase and clarity in your application code when you construct and parse these keys.

### Modeling One-to-Many Relationships

One-to-many relationships are where single-table design truly shines. A user has many orders. An order has many items. A product has many reviews.

The technique is straightforward: use the parent entity's identifier as the partition key, and craft the sort key to include the child entity type and identifier.

Building on our earlier example, to model "a user has many orders," we keep all orders under the same partition key (`USER#<userId>`) and vary the sort key:

```
USER#123    ORDER#456
USER#123    ORDER#457
USER#123    ORDER#458
```

To retrieve all orders for user 123, you issue a query:

```
Query with PK = 'USER#123' AND SK begins_with 'ORDER#'
```

DynamoDB efficiently returns all matching items in sorted order (sort key order). If you craft your sort key to include a timestamp, orders naturally sort chronologically:

```
USER#123    ORDER#2024-01-15T10:30:00Z#456
USER#123    ORDER#2024-01-16T14:22:15Z#457
USER#123    ORDER#2024-01-17T09:45:30Z#458
```

Now a query for all orders from user 123 returns them in time order without explicit sorting.

Similarly, to model "an order has many items," you might use:

```
USER#123#ORDER#456    ITEM#001
USER#123#ORDER#456    ITEM#002
USER#123#ORDER#456    ITEM#003
```

Here the partition key includes both the user and order, which automatically groups all items for a specific order together. A query retrieves them all in one operation.

This approach has a subtle advantage: it prevents queries from accidentally crossing order boundaries. If you used `ORDER#456` as a partition key shared by all order items across all users, you'd be mixing data from different users in the same partition, which is inefficient and architecturally messier.

### Modeling Many-to-Many Relationships

Many-to-many relationships are trickier. A user has many products they've purchased; a product has many users who've purchased it. A student enrolls in many courses; a course has many students.

Single-table design handles these through additional table entries that represent the relationship itself. You don't model the relationship implicitly through a join table; instead, you store explicit items representing each side of the relationship.

Suppose a user can have many friends, and each friendship is bidirectional. You might model this as:

```
PK              SK
USER#123        FRIEND#456
USER#123        FRIEND#789
USER#456        FRIEND#123
USER#789        FRIEND#123
```

Here, each item explicitly represents one direction of the friendship. This is redundant—the friendship between 123 and 456 is stored twice—but it enables efficient queries from either direction.

A more sophisticated example involves products and reviews. A user has written many reviews; a product has many reviews. One table might hold:

```
PK                  SK
USER#123            REVIEW#PRODUCT#789#2024-01-15
USER#123            REVIEW#PRODUCT#456#2024-02-20
PRODUCT#789         REVIEW#USER#123#2024-01-15
PRODUCT#456         REVIEW#USER#123#2024-02-20
```

The same review is stored with two different partition keys: one keyed by the user (for "all reviews by this user") and one keyed by the product (for "all reviews of this product"). Again, this is denormalization, but it allows both queries to be single, efficient operations.

In practice, you typically store the full review data in one record and store just a reference or metadata in the other. Or you use a global secondary index to enable querying from the opposite direction without duplicating all the data.

### Global Secondary Indexes and Index Overloading

Not all access patterns fit neatly into your primary key structure. This is where global secondary indexes (GSIs) come in.

A global secondary index is a separate index on your table with its own partition and sort key. You can define up to ten GSIs per table, and each one can have a completely different key structure than the primary table.

Many single-table designs use what's sometimes called "index overloading"—designing your GSIs with the same flexibility as your primary key. For example, if your table's primary key is:

```
PK: USER#<userId>
SK: ORDER#<orderId>
```

And you need to query "all orders placed on a specific date," you might define a GSI:

```
GSI1_PK: created_date
GSI1_SK: user_id
```

Now you can query:

```
Query GSI1 with GSI1_PK = '2024-01-15' AND GSI1_SK = 'USER#123'
```

And retrieve all orders from that user on that date.

The "overloading" comes in when you design your GSIs to hold multiple entity types just like your primary key does. For instance, your GSI1_PK might hold `DATE#<dateString>` for orders but `CATEGORY#<category>` for products, and your GSI1_SK holds different entity identifiers depending on context. The index supports multiple query patterns through a single, flexible key structure.

Here's a practical example. Your table might have:

```
PK              SK                      GSI1_PK           GSI1_SK
USER#123        PROFILE#               USER#123          ACCOUNT_STATUS#ACTIVE
USER#123        ORDER#456              DATE#2024-01-15   ORDER#456
USER#456        PROFILE#               USER#456          ACCOUNT_STATUS#ACTIVE
PRODUCT#789     DETAILS#               CATEGORY#BOOKS    PRODUCT#789
```

The primary key lets you fetch a user and all their orders efficiently. The GSI lets you find all active users (by querying `GSI1_PK = ACCOUNT_STATUS#ACTIVE`) or all book products (by querying `GSI1_PK = CATEGORY#BOOKS`). With overloaded key structures, a single GSI can serve multiple query shapes.

### Attribute Overloading

Beyond key overloading, single-table designs often use attribute overloading—storing semantically different data in the same attribute column depending on context.

For example, you might have an `amount` attribute that represents an order total for order items but represents a price for product items. Or a `name` attribute that represents a user name for user items and a product name for product items.

While this might feel untidy, it's an intentional trade-off. The table schema remains simple (fewer columns), and the meaning is determined by the entity type encoded in your primary key. Your application code handles the interpretation.

Attribute overloading becomes important when you're mindful of DynamoDB's item size limit (400 KB per item) and storage costs. By reusing columns, you keep items lean. But it does require careful documentation and disciplined code—you need clear comments and type definitions in your data access layer to make it obvious what each attribute means in each context.

### A Concrete Example: Users, Orders, and Items

Let's walk through a complete example that brings these concepts together.

Imagine you're building an order management system with these access patterns:

1. Fetch a user profile by user ID
2. Get all orders for a user
3. Get a specific order and all its line items
4. Find orders by date (all orders placed on January 15, 2024)
5. Search products by category

Your primary key might be:

```
PK: entity_identifier (USER#<userId>, ORDER#<orderId>, PRODUCT#<productId>)
SK: entity_type_and_details
```

A concrete table structure:

```
PK              SK                      entity_type    amount    created_at      attributes
USER#alice      PROFILE#               user           —         2023-06-01      {name: "Alice", email: "alice@example.com"}
USER#alice      ORDER#001              order          150.00    2024-01-15      {order_id: "001"}
USER#alice      ORDER#001#ITEM#1       order_item     75.00     2024-01-15      {product_id: "prod-789", qty: 1}
USER#alice      ORDER#001#ITEM#2       order_item     75.00     2024-01-15      {product_id: "prod-790", qty: 1}
USER#bob        PROFILE#               user           —         2023-08-20      {name: "Bob", email: "bob@example.com"}
USER#bob        ORDER#002              order          200.00    2024-01-16      {order_id: "002"}
USER#bob        ORDER#002#ITEM#1       order_item     200.00    2024-01-16      {product_id: "prod-789", qty: 2}
PRODUCT#prod-789 DETAILS#              product        45.00     2023-01-01      {name: "Widget", category: "TOOLS"}
PRODUCT#prod-790 DETAILS#              product        30.00     2023-02-15      {name: "Gadget", category: "TOOLS"}
```

Access patterns and their queries:

**Pattern 1: Fetch user profile**
```
Query with PK = 'USER#alice' AND SK = 'PROFILE#'
Response: One item with user details
```

**Pattern 2: Get all orders for a user**
```
Query with PK = 'USER#alice' AND SK begins_with 'ORDER#'
Response: All order items for Alice, sorted by sort key
```

**Pattern 3: Get a specific order and all its items**
```
Query with PK = 'USER#alice' AND SK begins_with 'ORDER#001'
Response: The order item plus all order_item records, all together
```

**Pattern 4: Find orders by date**

This pattern doesn't fit the primary key structure, so you'd create a GSI:

```
GSI1_PK: order_date (derived from the order's created_at)
GSI1_SK: user_id
```

Then query:
```
Query GSI1 with GSI1_PK = '2024-01-15' AND GSI1_SK = 'USER#alice'
Response: All orders placed by Alice on January 15, 2024
```

**Pattern 5: Search products by category**

Another GSI:
```
GSI2_PK: category
GSI2_SK: product_name
```

Then query:
```
Query GSI2 with GSI2_PK = 'TOOLS'
Response: All products in the TOOLS category, sorted alphabetically by name
```

In code, your data access layer would construct and parse these keys. Here's a simplified pseudocode example:

```python
# Fetch user profile
def get_user(user_id):
    response = dynamodb.get_item(
        Key={
            'pk': f'USER#{user_id}',
            'sk': 'PROFILE#'
        }
    )
    return response['Item']

# Get all orders for user
def get_user_orders(user_id):
    response = dynamodb.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={
            ':pk': f'USER#{user_id}',
            ':sk': 'ORDER#'
        }
    )
    return [item for item in response['Items'] if item['entity_type'] == 'order']

# Get order and its items
def get_order_details(user_id, order_id):
    response = dynamodb.query(
        KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues={
            ':pk': f'USER#{user_id}',
            ':sk': f'ORDER#{order_id}'
        }
    )
    # Items are naturally grouped: order item first, then order_items
    return response['Items']
```

### Design Considerations and Trade-offs

Single-table design is powerful, but it's not free. Understanding the trade-offs helps you decide when it's the right approach.

**Advantages:**

Single-table design dramatically reduces API calls. Instead of fetching a user, then querying orders, then fetching each order's items, you get everything in one or two queries. This reduces latency and cost, especially at scale. It also simplifies your deployment model—you manage one table instead of many, which reduces operational complexity. And DynamoDB's pricing model rewards efficient queries; fewer round trips means lower bills.

The design also forces you to think deeply about your access patterns upfront. This intentionality often leads to better-architected applications because you've explicitly considered how data flows through the system.

**Disadvantages:**

Single-table design requires more upfront planning. You must enumerate access patterns before you start coding. Adding new access patterns later sometimes requires schema redesign and data migration.

The design can feel denormalized and unfamiliar if you come from a relational background. Attributes hold different meanings depending on entity type. Data is sometimes stored redundantly. This requires discipline in code—clear entity type checks, careful documentation, and consistent parsing logic.

Debugging can be harder. A SQL database gives you clear table structure; a single-table design hides complexity in key formats and requires more knowledge to query effectively. Your team needs to understand the key scheme.

And there are scenarios where single-table design doesn't fit well. If your access patterns are highly variable or unpredictable, a single-table design becomes brittle. If your data has weak relationships (a user doesn't consistently "own" orders in a hierarchical sense), single-table design forces awkward modeling.

### When to Use Single-Table Design

Single-table design is ideal for applications with stable, well-understood access patterns and clear hierarchical relationships. E-commerce, content management, social networks, and gaming leaderboards are classic domains where it excels.

Use single-table design when:

- Your access patterns are known and relatively stable. You've explicitly enumerated how your application queries the data.
- Your data has natural hierarchies—users own orders, orders contain items, accounts belong to organizations.
- Performance and cost are critical concerns. You want minimal latency and API calls.
- Your table is the core of your system. If DynamoDB is a secondary data store for occasional lookups, the complexity may not be justified.

Consider multi-table designs when:

- Your access patterns are highly unpredictable or change frequently. A traditional schema is more flexible.
- Your entities are loosely related. There's no clear hierarchical grouping that becomes your partition key.
- Your team is unfamiliar with DynamoDB. The learning curve for single-table design is steeper, and a simpler approach might be better for getting to market quickly.
- You're mixing DynamoDB with relational data. A hybrid approach might involve relational tables for heavily-joined data and DynamoDB tables for high-traffic, read-heavy access patterns.

### Migration and Evolution

One common concern is that single-table designs lock you in. What if you need to add a new access pattern months from now?

In practice, you can evolve a single-table design by adding new GSIs. Most new access patterns can be supported by defining an additional index with appropriate key structure. Since GSIs are eventually consistent, there's a small overhead, but it's far less disruptive than restructuring a normalized schema across multiple tables.

Data migration for adding new access patterns typically involves:

1. Define the new GSI.
2. Set DynamoDB Streams to capture new writes.
3. Run a batch job to populate the GSI with historical data.
4. Once caught up, update your application code to use the new index.

This process is reasonably smooth and doesn't require application downtime.

### Practical Tools and Patterns

Several tools and patterns have emerged in the DynamoDB community to make single-table design more manageable.

**Key builders and parsers:** Many teams create utility functions to construct and parse composite keys. This centralizes the logic and makes it easier to evolve key schemes without scattering changes throughout the codebase.

**Entity type discriminators:** Always include a discriminator attribute (like `entity_type` in our examples) to clarify what kind of entity an item represents. This makes querying and filtering simpler and more explicit.

**Type-safe wrappers:** Languages like TypeScript allow you to create type definitions for each entity type. This helps catch bugs where you're accessing the wrong attributes for a given entity type.

**DynamoDB query builders:** Libraries exist in popular languages that make constructing queries against single-table designs easier, handling key construction and parsing transparently.

### Conclusion

Single-table design represents a paradigm shift from the relational database patterns most developers learned first. Rather than normalizing data across multiple tables, single-table design stores related data together, indexed through carefully crafted composite keys. This approach aligns with how DynamoDB actually works—optimizing for fast, direct access through primary keys rather than expensive joins.

The pattern requires upfront thinking about access patterns, intentional key design, and discipline in application code. But the rewards are substantial: lower latency, reduced API calls, simpler operational complexity, and better alignment with DynamoDB's pricing model.

As you design DynamoDB applications, start by enumerating your access patterns. Let them guide your key structure. Use partition keys to group related items, sort keys to distinguish and order them, and GSIs to enable access patterns that don't fit your primary key design. Think of your table as a flexible data store shaped around how your application accesses it, not as a rigid schema imposed from above.

Mastering single-table design isn't just about passing assessments—it's about building DynamoDB applications that are fast, cost-effective, and maintainable. It's a skill that pays dividends as your systems scale.
