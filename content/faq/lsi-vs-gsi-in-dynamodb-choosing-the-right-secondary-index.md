---
title: "LSI vs GSI in DynamoDB: Choosing the Right Secondary Index"
---

## LSI vs GSI in DynamoDB: Choosing the Right Secondary Index

DynamoDB's query flexibility hinges on secondary indexes, but choosing between Local Secondary Indexes (LSI) and Global Secondary Indexes (GSI) confuses many developers. The decision isn't academic—it shapes your table's scalability, cost, consistency guarantees, and operational complexity. Get it wrong, and you'll either hit hard limits mid-project or overspend on unnecessary provisioned capacity. This article cuts through the confusion by examining the fundamental architectural differences, practical constraints, and decision criteria that determine which index type serves your use case.

### Why Secondary Indexes Matter

By default, DynamoDB queries run against your table's primary key: the partition key (required) and optional sort key. This works beautifully for your main access pattern, but real applications rarely need just one way to access data. You might query orders by customer ID, by order date, by status—but your primary key is structured for something else entirely.

Secondary indexes solve this problem by allowing you to query alternative attributes without scanning the entire table. However, DynamoDB offers two fundamentally different approaches, each with distinct tradeoffs. Understanding these tradeoffs is essential for building resilient, cost-effective applications.

### Understanding the Partition Model: Where LSI and GSI Diverge

The most consequential difference between LSI and GSI lies in how they partition data. This single architectural decision cascades into nearly every other property you'll need to consider.

An LSI shares the same partition key as the base table. When you create an LSI, you're telling DynamoDB: "Store an alternate view of these items, sorted by a different attribute, but keep them in the same partition." This shared partition architecture means an LSI has a hard storage limit of 10 GB per partition key value. If a customer has 15 GB of order history and you want to index those orders by status, you cannot use an LSI because the combined size of all items with that partition key value would exceed the limit.

A GSI, by contrast, has its own partition key—completely independent of the base table. It maintains separate physical partitions, separate throughput capacity, and a separate distributed hash structure. When DynamoDB replicates data to a GSI, it's building an entirely separate table under the hood, just with a different partition key structure.

This architectural difference explains why LSIs must be created at table creation time—their partitions are bound to the base table's partition scheme—while GSIs can be added or removed after the fact. Adding a GSI is essentially creating a new table and populating it from the base table's data stream.

### The 10 GB Limit: When LSI Becomes a Constraint

The 10 GB per partition key value limit on LSIs is not theoretical; it's a hard ceiling that catches many developers off-guard. To understand its impact, consider a real scenario: you're building a SaaS platform where customers have varying data volumes. Enterprise customers might accumulate 8 GB of historical data under their partition key. If you've indexed this data with an LSI to support a critical query pattern, you've used 80 percent of your limit. A few months later, that customer's usage doubles, and your LSI is full.

With a GSI, this isn't a concern. Each GSI partition key value can grow independently across the distributed hash ring. There's no per-partition-key-value limit—only the practical AWS account limits and your provisioned capacity.

This constraint makes LSIs appropriate only for specific scenarios: entities with bounded, predictable data volume per partition key value, such as user profiles where each user accumulates only a few megabytes of metadata, or orders within a time window. Avoid LSIs when you're modeling hierarchical or open-ended collections.

### Provisioning and Capacity: Independent vs Shared

Another critical architectural difference involves capacity provisioning. An LSI shares read and write capacity with the base table. Every read you perform against an LSI consumes capacity from the same pool as base table reads. This means a traffic spike on an LSI could starve your primary table queries.

A GSI maintains independent provisioned capacity. You specify separate read and write capacity units (or enable auto-scaling separately) for each GSI. This isolation is powerful: you can provision a heavily-used GSI for massive read traffic without affecting your base table's provisioning, and vice versa. However, this independence comes at a cost—GSI capacity is billed separately, so multiple GSIs multiply your provisioned capacity costs.

For applications with multiple indexes or unpredictable query patterns, GSIs provide better isolation and predictability. For simple applications with a single secondary query pattern and stable, related traffic patterns, sharing capacity via LSI can reduce costs.

### Consistency Models: Strong vs Eventual

DynamoDB guarantees strong consistency on the base table and LSI queries. When you write to an item and immediately query it via the same LSI, you're guaranteed to see that write. This is because the LSI is co-located with the base table in the same partition—the replication is synchronous.

GSI queries only support eventual consistency. AWS replicates GSI data asynchronously from the base table's replication stream, typically within milliseconds but not instantly. If you write an order and immediately query a GSI on order status, you might see the old status briefly. For many applications, this is fine; for others, it's a deal-breaker.

This distinction has profound implications for transactional semantics. If you have a two-step process where you update an item and immediately query a GSI expecting that update to be visible, you need an LSI (or you must implement application-level retry logic with backoff for eventual consistency).

### Projection: Storage, Cost, and Query Efficiency

When you create a secondary index, you must decide which attributes to replicate from the base table into the index. DynamoDB offers three projection strategies, each with different implications for storage cost and query behavior.

**KEYS_ONLY** projects only the primary key attributes and the index key attributes. If you later need data not in the projection, DynamoDB automatically fetches it from the base table in a separate request. This minimizes index storage but can double your read cost if you frequently need unprojected attributes. KEYS_ONLY makes sense for indexes on high-cardinality attributes where most queries will need additional attributes anyway.

**INCLUDE** lets you specify a list of attributes to project alongside the keys. You might project the customer ID, order ID, order status (the index key), and customer name, avoiding the need to fetch the base table for a common query pattern. INCLUDE balances storage and performance, making it the most pragmatic choice for most applications.

**ALL** projects every attribute from the base table into the index. Your query never needs to fetch the base table, minimizing latency and providing guaranteed consistency for the returned data. However, ALL doubles your storage footprint for that index, and you pay for replicating every attribute change, even attributes not used by queries on that index.

For LSIs, the projection cost is especially acute because replication is synchronous—projecting all attributes directly impacts write latency on the base table. For GSIs, replication is asynchronous, but storage and stream consumption costs still accumulate.

A practical approach: start with KEYS_ONLY for exploratory indexes, then upgrade to INCLUDE based on actual query patterns observed in production. Use ALL only when you've confirmed that the attribute coverage is broad enough to justify the storage overhead.

### Creating Indexes: Timing and Operational Constraints

LSI creation is a one-time decision, made at table creation before any data exists. You cannot add or modify LSIs after table creation. This isn't just an operational limitation—it's a fundamental consequence of the shared partition architecture. Adding an LSI would require reshuffling all base table partitions.

This immutability demands careful planning. Developers must anticipate secondary query patterns before launching the table. If you later discover a critical query pattern that requires a different sort key, your options are limited: create a new table with the LSI and migrate data, or pivot to a GSI (which you can add immediately).

GSI creation, by contrast, is a runtime operation. You can add a GSI to an existing table with data already present. AWS asynchronously builds the index from the existing data stream and the table's continuous write stream. The base table remains available for reads and writes throughout the process, though the table may become "creating" and slightly throttled during the build. For tables with millions of items, this can take several minutes.

This flexibility is valuable but easy to misuse. Developers sometimes create GSIs speculatively, "just in case" they're needed, incurring capacity costs for unused indexes. Establish a discipline: measure your actual query patterns before adding GSIs, and delete unused indexes monthly.

### Sparse Indexes and Query Optimization

Both LSI and GSI support sparse indexing—a feature where not every item in the base table appears in the index. If you create an index on a sort key attribute that doesn't exist on all items, DynamoDB includes only items where that attribute is present.

This behavior is powerful for certain patterns. Imagine a user table where most users are active, but a minority are deactivated. You create a sparse GSI on a "deactivation_date" attribute. Only deactivated users appear in the index. Querying the index gives you deactivated users without scanning for null values.

Sparse indexing works the same for LSI and GSI, but the implications differ. For an LSI, sparse indexing helps you stay under the 10 GB per-partition-key limit by excluding irrelevant items. For a GSI, it reduces index size and provisioned capacity requirements.

### Decision Framework: Choosing Between LSI and GSI

With these architectural differences clear, you can develop a rational decision process. Start by identifying your secondary query patterns and estimating data volume per partition key value.

If the secondary query pattern requires strong consistency immediately after a write, you likely need an LSI. Examples include inventory systems where you query current stock status moments after updating it, or financial transactions where you verify a recent transfer's status.

If the data volume for any partition key value exceeds 5 GB, or you anticipate it growing beyond 10 GB within your planning horizon, GSI is mandatory. LSI's limit is non-negotiable.

If you anticipate adding or modifying indexes after table creation, or if you need multiple indexes on the same base table with different partition keys, GSI provides the operational flexibility. LSI forces all secondary queries to use the base table's partition key.

If you need to query by attributes with extremely high cardinality (millions of unique values), a GSI is more efficient because it distributes the load across partitions independently of the base table's partition key distribution. An LSI with a high-cardinality sort key can create hot partitions in the base table.

If cost is a primary concern and your query traffic pattern is stable and predictable, LSI might be cheaper because it shares base table capacity. However, calculate this carefully: a GSI with separate capacity might actually cost less than over-provisioning the base table to handle both primary and secondary query load.

For most modern applications, especially those requiring flexibility and multi-tenant isolation, GSI is the safer choice. The additional cost of separate provisioned capacity is a small price for avoiding architectural constraints that bite later.

### Practical Example: Building a Flexible Order System

Consider a real e-commerce scenario: an Orders table partitioned by customer ID, storing order data with attributes like order_id, order_date, status, and total_amount.

Your primary query pattern is "fetch all orders for a customer, sorted by date." This uses the base table with partition key customer_id and sort key order_date.

Your secondary pattern is "fetch all orders with status='pending' across all customers." This pattern doesn't care about customer ID; it needs to scan status values globally. You create a GSI with partition key status and sort key order_date. Because this index scans across all customers, it must be a GSI—an LSI would be restricted to a single customer's orders. The GSI can be added later without reshaping the base table.

Another pattern emerges: "fetch orders placed today by any customer." You add a second GSI with partition key order_date and sort key customer_id. Your base table and two GSIs coexist, each optimized for a different query pattern, with independent capacity provisioning.

If you'd tried to handle all three patterns with an LSI, you'd run into obstacles immediately. An LSI shares customer_id as the partition key, so you couldn't create an index on status or order_date as a partition key. You'd be forced to query the base table and filter, sacrificing efficiency.

### Replication Cost Implications

Storage isn't the only cost multiplier; replication throughput matters too. Every write to an item that has attributes projected into a GSI consumes write capacity on both the base table and the GSI. If you have multiple GSIs with overlapping projections, a single write might consume capacity three or four times over.

For LSIs, writes consume base table capacity but don't incur separate GSI write costs—the replication is included. This can make LSI cheaper for write-heavy workloads, though the benefit is offset by the 10 GB limit and the inability to distribute write load via independent capacity provisioning.

In practice, GSI write cost surprises few developers if they've sized provisioned capacity correctly, but it catches those who didn't account for multiple indexes. If you're considering three GSIs, provision write capacity as though each write affects multiple indexes.

### When to Avoid Secondary Indexes Entirely

Not every secondary query pattern requires an index. For queries that affect less than 5 percent of your data, a filtered scan might be more cost-effective than maintaining a GSI, especially if the query runs infrequently.

DynamoDB scans are often demonized, but they're appropriate when you're accessing a large percentage of your data anyway. Scanning a 1 MB table with a filter is cheaper than maintaining a GSI for a rarely-used pattern.

Conversely, avoid creating LSIs for "future-proofing." The immutability of LSIs means you're betting that a secondary query pattern will remain relevant for the table's lifetime. If you're wrong, you're stuck.

### Testing and Validation

Before committing to an index strategy, test it. Use AWS's query planning tools and CloudWatch metrics to measure actual query patterns and capacity consumption. A pattern you think will be common might turn out to be rare; conversely, unexpected query patterns might emerge.

Create a test table with production-like data volume, add both LSI and GSI versions of your secondary indexes, and measure query latency, capacity consumption, and storage cost. Let the data guide your decision rather than intuition.

### Conclusion

LSI and GSI serve different needs, rooted in fundamental architectural differences. LSI's shared partitions and strong consistency make it suitable for bounded, related queries on items with the same partition key. GSI's independence and flexibility make it the default choice for modern applications with complex query patterns.

The decision hinges on three factors: your consistency requirements, your per-partition-key-value data volume, and your operational needs. Strong consistency requirements and small data volumes favor LSI. Large data volumes, multiple indexes, and the need to add indexes after table creation favor GSI.

Neither is universally better—only better for your specific constraints. By understanding the architectural differences and applying the decision framework in this article, you'll design DynamoDB tables that scale efficiently and cost predictably.
