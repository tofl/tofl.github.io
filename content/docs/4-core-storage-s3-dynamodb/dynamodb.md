---
title: "10. DynamoDB"
type: docs
weight: 2
---

## DynamoDB

Amazon DynamoDB is a fully managed, serverless NoSQL database built for applications that need consistent, single-digit millisecond performance at any scale. Unlike relational databases, you don't provision or manage servers — AWS handles availability, replication, and scaling automatically. DynamoDB is the go-to database for serverless architectures on AWS, and it's one of the most heavily tested services on the DVA-C02 exam.

The core problem it solves: traditional relational databases struggle to scale horizontally and often become bottlenecks under unpredictable or high traffic. DynamoDB sidesteps this by distributing data across partitions and offering near-instant reads and writes regardless of load.

**Official starting point:** [DynamoDB Developer Guide](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Introduction.html)

### Tables, Items, and Attributes

DynamoDB organizes data into **tables**. Each table contains **items** (equivalent to rows), and each item contains **attributes** (equivalent to columns). The key difference from relational databases: DynamoDB is **schema-less**. Aside from the primary key, items in the same table can have completely different attributes. This flexibility makes it well-suited for heterogeneous data like user profiles, product catalogs, or event logs.

### Primary Keys

Every item in a table is uniquely identified by its **primary key**, which you define at table creation and cannot change afterward. DynamoDB supports two types:

- **Partition key only (simple primary key):** A single attribute (e.g., `userId`) that DynamoDB hashes to determine which partition stores the item. Each value must be unique across the table.
- **Partition key + sort key (composite primary key):** Two attributes combined. Items can share the same partition key as long as their sort keys differ. This is useful for one-to-many relationships — for example, `userId` as partition key and `orderDate` as sort key to store multiple orders per user.

Choosing the right primary key is critical. A **high-cardinality partition key** (many distinct values, evenly distributed) ensures that reads and writes are spread across partitions rather than concentrated on a few "hot" partitions, which would throttle performance. A common anti-pattern is using a low-cardinality value like `status` or `country` as the partition key. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-partition-key-design.html)

### Read/Write Capacity Modes

DynamoDB offers two capacity modes, switchable at any time:

- **Provisioned mode:** You specify the number of **Read Capacity Units (RCUs)** and **Write Capacity Units (WCUs)** your table needs. Best when traffic is predictable. You can attach **Auto Scaling** to adjust capacity automatically within defined bounds.
- **On-Demand mode:** DynamoDB scales instantly with your traffic — no capacity planning required. You pay per request. Best for unpredictable or spiky workloads, though the per-request cost is higher.

**RCU calculation** is a common exam topic:
- 1 RCU = 1 **strongly consistent** read per second for an item up to 4 KB
- 1 RCU = 2 **eventually consistent** reads per second for an item up to 4 KB
- For transactional reads: 2 RCUs per 4 KB

So reading a 10 KB item with strong consistency costs 3 RCUs (ceil(10/4) = 3). [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html)

**WCU calculation:**
- 1 WCU = 1 write per second for an item up to 1 KB
- Transactional writes cost 2 WCUs per 1 KB

### Strong vs. Eventual Consistency

By default, DynamoDB reads are **eventually consistent** — you might briefly read slightly stale data after a write, because DynamoDB replicates across multiple Availability Zones and propagation takes a moment. For use cases where you need the most up-to-date data immediately after a write, you can request a **strongly consistent** read (at the cost of double the RCUs and slightly higher latency). Not all operations support strong consistency — notably, GSI reads are always eventually consistent.

### Secondary Indexes

When you need to query your table by attributes other than the primary key, you use secondary indexes:

- **Local Secondary Index (LSI):** Same partition key as the base table, but a different sort key. Must be created at table creation time. Shares the provisioned capacity of the base table. Supports strong consistency. Useful when you need alternate sort orders within the same partition — e.g., query orders by `userId` sorted by `amount` instead of `orderDate`.

- **Global Secondary Index (GSI):** Completely different partition key and optional sort key. Can be added or removed at any time. Has its own separate provisioned capacity. Always eventually consistent. More flexible — for example, querying a `products` table by `category` instead of `productId`.

A practical rule of thumb: if you find yourself scanning a table to find items, you probably need a GSI. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/SecondaryIndexes.html)

### DynamoDB Streams

DynamoDB Streams captures a time-ordered log of every change (insert, update, delete) made to items in a table. Records are retained for 24 hours. This is the foundation for **change data capture** patterns — you can trigger a Lambda function for every change, enabling use cases like:

- Replicating changes to another table or data store
- Sending notifications when an item is modified
- Aggregating analytics in near-real time

Each stream record contains the item's before and after state (configurable: keys only, new image, old image, or both images). [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Streams.html)

**DynamoDB Streams with Kinesis Data Streams:** For higher throughput or longer retention (up to 1 year), you can replicate DynamoDB change data directly into a Kinesis Data Stream. This is useful when your downstream consumers need more time to process events or when you're feeding multiple consumers from the same stream. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/kds.html)

### TTL — Time to Live

TTL lets you define an attribute on each item that holds a Unix timestamp. When that timestamp is reached, DynamoDB automatically deletes the item — no application code needed, no capacity consumed. Deletions typically happen within 48 hours of expiry. This is ideal for session data, temporary tokens, audit logs with a retention window, or any data that becomes irrelevant after a fixed period. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/TTL.html)

### Transactions

DynamoDB Transactions let you perform multiple reads or writes as a single, atomic operation — all succeed or all fail. Two API calls to know:

- **`TransactGetItems`** — reads up to 100 items atomically across one or more tables
- **`TransactWriteItems`** — writes up to 100 items atomically (puts, updates, deletes, condition checks)

Transactions are useful when you need to update multiple related items consistently, like deducting inventory and creating an order record simultaneously. Keep in mind they cost 2x the normal RCU/WCU. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html)

### Conditional Writes and Optimistic Locking

A **conditional write** only succeeds if a specified condition is true at the time of the write — for example, only update an item if a `status` attribute equals `"pending"`. This prevents overwriting data that has changed between when you read it and when you write it.

**Optimistic locking** builds on this pattern using a version number attribute (e.g., `version`). When you update an item, you include a condition that the version in the database still matches the version you read. If another process updated the item in between, the condition fails and your write is rejected — forcing you to re-read and retry. This is the standard approach for avoiding lost updates in concurrent environments. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBMapper.OptimisticLocking.html)

### Reading and Writing Data: Key API Operations

- **`PutItem` / `UpdateItem` / `DeleteItem`** — single-item writes
- **`GetItem`** — single-item read by primary key
- **`BatchGetItem`** — read up to 100 items in a single call (across tables). Unprocessed items are returned and must be retried.
- **`BatchWriteItem`** — write or delete up to 25 items in a single call. Note: does not support updates, only puts and deletes.
- **`Query`** — retrieves items from a table or index that share the same partition key, with optional sort key filtering. Efficient and the preferred access pattern.
- **`Scan`** — reads every item in the table and optionally filters results. Expensive and slow on large tables — avoid it in production access patterns.

For large tables, **Parallel Scan** splits the scan across multiple workers to increase throughput, though it still consumes significant capacity. If you're relying on scans, reconsider your data model or add a GSI. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html)

### DynamoDB Accelerator (DAX)

DAX is a fully managed, in-memory cache designed specifically for DynamoDB. It sits in front of your table and delivers **microsecond read latency** (vs. single-digit millisecond from DynamoDB directly). It's a **write-through cache**: writes go to both DAX and DynamoDB simultaneously, keeping the cache consistent.

DAX is ideal when your application has **read-heavy workloads** with repeated access to the same items — product detail pages, leaderboards, or reference data. It is not suitable for strongly consistent reads (DAX always returns eventually consistent results), write-heavy workloads, or infrequently accessed data. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DAX.html)

### Backup: On-Demand and PITR

- **On-demand backups** create a full snapshot of your table at any point. Backups are retained until explicitly deleted and have no impact on table performance.
- **Point-in-Time Recovery (PITR)** continuously backs up your table for up to **35 days**, letting you restore the table to any second within that window. It protects against accidental writes or deletes. PITR is disabled by default — enable it explicitly. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html)

### Global Tables

DynamoDB Global Tables provide **multi-region, multi-active** replication. You define replica tables in multiple AWS regions, and DynamoDB keeps them synchronized. Any region can accept both reads and writes — writes are automatically propagated to all other replicas, typically within one second.

This enables low-latency access for globally distributed users and built-in disaster recovery. Conflict resolution uses a **last-writer-wins** strategy based on timestamps. Global Tables require DynamoDB Streams to be enabled. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GlobalTables.html)

### Encryption at Rest

All DynamoDB tables are encrypted at rest by default. You can choose:

- **AWS owned key** (default) — managed entirely by AWS, no cost, no visibility
- **AWS managed key (`aws/dynamodb`)** — visible in KMS, no additional key management required
- **Customer managed key (CMK)** — full control, audit via CloudTrail, additional KMS cost

Encryption is applied to all data including indexes, streams, and backups. [🔗](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html)