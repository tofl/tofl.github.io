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

{{< qcm >}}
[
{
"question": "A DynamoDB table stores customer orders using `customerId` as the partition key and `orderDate` as the sort key. A developer needs to retrieve all orders for a specific customer placed after a given date. Which API operation is the most efficient choice?",
"answers": [
{
"answer": "Scan with a FilterExpression on `customerId` and `orderDate`",
"isCorrect": false,
"explanation": "Scan reads every item in the table before filtering, making it expensive and slow. It should be avoided as a primary access pattern."
},
{
"answer": "Query using the partition key `customerId` and a sort key condition on `orderDate`",
"isCorrect": true,
"explanation": "Query is the correct and most efficient operation here. It targets a specific partition key and can apply sort key conditions (e.g., greater than a date), returning only the relevant items without scanning the entire table."
},
{
"answer": "BatchGetItem specifying all known order keys",
"isCorrect": false,
"explanation": "BatchGetItem requires you to know the exact primary keys of items to retrieve. It cannot filter by a range condition on the sort key."
},
{
"answer": "GetItem with a condition on `orderDate`",
"isCorrect": false,
"explanation": "GetItem retrieves a single item by its exact primary key. It does not support range conditions or returning multiple items."
}
]
},
{
"question": "A DynamoDB table is configured in provisioned capacity mode. An item is 10 KB in size. How many RCUs are required to perform a strongly consistent read of this item?",
"answers": [
{
"answer": "2 RCUs",
"isCorrect": false,
"explanation": "2 RCUs would cover an eventually consistent read of a 10 KB item (ceil(10/4) = 3 RCUs for strongly consistent, halved to 1.5 → rounded up to 2 for eventually consistent). For strong consistency, 3 RCUs are required."
},
{
"answer": "3 RCUs",
"isCorrect": true,
"explanation": "1 RCU covers 1 strongly consistent read per second for up to 4 KB. For a 10 KB item: ceil(10/4) = 3. Therefore, 3 RCUs are needed."
},
{
"answer": "5 RCUs",
"isCorrect": false,
"explanation": "5 RCUs would over-count. The formula is ceil(item size KB / 4), which gives ceil(10/4) = 3 for a strongly consistent read."
},
{
"answer": "6 RCUs",
"isCorrect": false,
"explanation": "6 RCUs would apply if this were a transactional read (2x the standard cost), which would be ceil(10/4) × 2 = 6. The question asks for a standard strongly consistent read, which costs 3 RCUs."
}
]
},
{
"question": "A developer is designing a DynamoDB table and wants to query products by `category`, even though the primary key is `productId`. The developer needs to be able to add this capability without recreating the table. Which solution is appropriate?",
"answers": [
{
"answer": "Create a Local Secondary Index (LSI) on `category`",
"isCorrect": false,
"explanation": "LSIs must be created at table creation time and cannot be added afterward. They also share the same partition key as the base table, so they would not allow querying by `category` as a partition key."
},
{
"answer": "Create a Global Secondary Index (GSI) on `category`",
"isCorrect": true,
"explanation": "GSIs can be added to or removed from an existing table at any time. They support a completely different partition key (e.g., `category`), making them ideal for this use case."
},
{
"answer": "Use a Scan with a FilterExpression on `category`",
"isCorrect": false,
"explanation": "While technically possible, scanning the entire table to filter by category is inefficient and expensive at scale. It is not a recommended access pattern."
},
{
"answer": "Change the primary key to use `category` as the partition key",
"isCorrect": false,
"explanation": "The primary key of a DynamoDB table cannot be changed after creation. Additionally, `category` is a low-cardinality attribute and would create hot partitions."
}
]
},
{
"question": "Which of the following statements about DynamoDB Streams are correct? (Select TWO)",
"answers": [
{
"answer": "Stream records are retained for 24 hours",
"isCorrect": true,
"explanation": "DynamoDB Streams retains records for exactly 24 hours. After that, records are automatically removed."
},
{
"answer": "Stream records can be retained for up to 7 days",
"isCorrect": false,
"explanation": "Standard DynamoDB Streams only retains records for 24 hours. For longer retention (up to 1 year), you can replicate the stream into Kinesis Data Streams."
},
{
"answer": "You can configure a stream to capture the old image, new image, both, or keys only",
"isCorrect": true,
"explanation": "DynamoDB Streams supports four view types: KEYS_ONLY, NEW_IMAGE, OLD_IMAGE, and NEW_AND_OLD_IMAGES, letting you control what data is captured per change."
},
{
"answer": "DynamoDB Streams can only capture insert events, not updates or deletes",
"isCorrect": false,
"explanation": "DynamoDB Streams captures all three types of modifications: inserts, updates, and deletes."
},
{
"answer": "DynamoDB Streams must be disabled when Global Tables are used",
"isCorrect": false,
"explanation": "The opposite is true — DynamoDB Global Tables require Streams to be enabled, as replication across regions depends on the stream."
}
]
},
{
"question": "A company uses DynamoDB to store user session data. Sessions should automatically expire 24 hours after creation. What is the most operationally efficient way to implement this?",
"answers": [
{
"answer": "Schedule a Lambda function every hour to scan the table and delete expired items",
"isCorrect": false,
"explanation": "This approach requires custom code, consumes RCUs for scans and WCUs for deletes, and introduces operational overhead. It is far less efficient than using TTL."
},
{
"answer": "Enable TTL on the table and set the TTL attribute to a Unix timestamp 24 hours in the future when writing each item",
"isCorrect": true,
"explanation": "TTL is purpose-built for this use case. DynamoDB automatically deletes items when their TTL timestamp is reached, at no capacity cost and with no application code required."
},
{
"answer": "Use a conditional write to prevent reading expired items",
"isCorrect": false,
"explanation": "Conditional writes prevent writing stale data but do not delete items. They would not remove expired sessions from the table."
},
{
"answer": "Set the item's WCU to 0 after 24 hours to prevent further writes",
"isCorrect": false,
"explanation": "WCUs are a capacity setting on the table, not on individual items. They cannot be set per item and have no expiration effect."
}
]
},
{
"question": "A developer needs to read 50 items from a DynamoDB table in a single API call. The exact primary keys for all items are known. Which API operation should be used?",
"answers": [
{
"answer": "Query",
"isCorrect": false,
"explanation": "Query retrieves items sharing the same partition key with optional sort key filtering. It is not suited for fetching arbitrary items by their individual keys."
},
{
"answer": "Scan with a FilterExpression",
"isCorrect": false,
"explanation": "Scan reads the entire table, which is expensive and inefficient when the keys are already known."
},
{
"answer": "BatchGetItem",
"isCorrect": true,
"explanation": "BatchGetItem is designed for exactly this scenario: reading up to 100 items across one or more tables in a single call using their primary keys. It is efficient and the correct choice when keys are known."
},
{
"answer": "TransactGetItems",
"isCorrect": false,
"explanation": "TransactGetItems also reads multiple items atomically, but it costs 2x the RCUs and is intended for use cases requiring atomicity. For a simple multi-key read, BatchGetItem is preferred."
}
]
},
{
"question": "An e-commerce application needs to atomically deduct stock from an inventory item and create a new order record in DynamoDB — both operations must either succeed or fail together. Which API operation supports this requirement?",
"answers": [
{
"answer": "BatchWriteItem",
"isCorrect": false,
"explanation": "BatchWriteItem executes multiple writes in a single call but does NOT guarantee atomicity. Some writes may succeed while others fail."
},
{
"answer": "TransactWriteItems",
"isCorrect": true,
"explanation": "TransactWriteItems executes up to 100 write operations (puts, updates, deletes, condition checks) as a single atomic unit — all succeed or all fail. This is the correct choice for multi-item consistency."
},
{
"answer": "PutItem with a ConditionExpression",
"isCorrect": false,
"explanation": "A conditional PutItem applies atomicity to a single item. It cannot span two separate items or tables atomically."
},
{
"answer": "UpdateItem on both items sequentially",
"isCorrect": false,
"explanation": "Sequential individual writes are not atomic. If the second write fails, the first has already committed, leaving data in an inconsistent state."
}
]
},
{
"question": "A DynamoDB table uses a GSI. A developer queries the GSI and notices that the results are slightly out of date compared to the base table. What is the expected behavior causing this?",
"answers": [
{
"answer": "The GSI has not been provisioned with enough RCUs",
"isCorrect": false,
"explanation": "Insufficient RCUs would cause throttling, not stale reads. GSI reads are always eventually consistent regardless of capacity."
},
{
"answer": "GSI reads are always eventually consistent",
"isCorrect": true,
"explanation": "This is by design. Unlike LSIs, GSI reads cannot be made strongly consistent. There is always a propagation delay between base table writes and GSI updates."
},
{
"answer": "Strong consistency must be explicitly requested on GSI queries using `ConsistentRead=true`",
"isCorrect": false,
"explanation": "DynamoDB does not allow strongly consistent reads on GSIs. Setting `ConsistentRead=true` on a GSI query will return a validation error."
},
{
"answer": "The GSI needs to be recreated to synchronize with the base table",
"isCorrect": false,
"explanation": "Recreating the GSI would not resolve eventual consistency, which is an inherent and permanent characteristic of GSIs."
}
]
},
{
"question": "A developer is implementing a feature where an item should only be updated if its `status` attribute is still `\"pending\"` at the time of the write. Which DynamoDB feature enables this?",
"answers": [
{
"answer": "Optimistic locking with a version number",
"isCorrect": false,
"explanation": "Optimistic locking uses a version attribute to detect concurrent changes. While related, the question specifically asks about conditioning on a business attribute (`status`), which is directly a conditional write."
},
{
"answer": "Conditional write with a ConditionExpression",
"isCorrect": true,
"explanation": "A conditional write allows you to specify an expression that must evaluate to true for the write to proceed. Setting a condition on `status = 'pending'` ensures the item is only updated if it hasn't already been processed."
},
{
"answer": "TransactWriteItems with a condition check",
"isCorrect": false,
"explanation": "While TransactWriteItems supports condition checks, using a transaction adds unnecessary overhead and cost (2x WCUs) for a single-item conditional update. A simple conditional UpdateItem is more appropriate."
},
{
"answer": "DynamoDB Streams to detect and revert invalid updates",
"isCorrect": false,
"explanation": "Streams capture changes after they happen. They cannot prevent a write from occurring in the first place."
}
]
},
{
"question": "Which of the following are valid use cases for DynamoDB Accelerator (DAX)? (Select TWO)",
"answers": [
{
"answer": "A leaderboard that is read thousands of times per second for the same top-10 records",
"isCorrect": true,
"explanation": "DAX is ideal for read-heavy workloads with repeated access to the same items. Caching top leaderboard entries in microsecond-latency memory is a textbook DAX use case."
},
{
"answer": "An application requiring strongly consistent reads after each write",
"isCorrect": false,
"explanation": "DAX always serves eventually consistent reads from its cache. Applications requiring strong consistency must bypass DAX and read directly from DynamoDB."
},
{
"answer": "A product catalog page that serves the same popular items repeatedly",
"isCorrect": true,
"explanation": "Frequently accessed reference data like popular product pages benefits greatly from DAX's in-memory caching, reducing both latency and load on the DynamoDB table."
},
{
"answer": "A write-heavy IoT ingestion pipeline processing millions of unique sensor events per minute",
"isCorrect": false,
"explanation": "DAX is not optimized for write-heavy workloads. Writes still pass through to DynamoDB, and unique, non-repeated data provides little benefit from caching."
}
]
},
{
"question": "A developer sets up Point-in-Time Recovery (PITR) on a DynamoDB table. An accidental bulk delete occurs. What is the maximum recovery window PITR provides?",
"answers": [
{
"answer": "7 days",
"isCorrect": false,
"explanation": "7 days is the retention period for some other AWS services (e.g., SQS messages), but not for DynamoDB PITR."
},
{
"answer": "35 days",
"isCorrect": true,
"explanation": "PITR continuously backs up the table and allows restoration to any second within the last 35 days. It is the maximum recovery window available."
},
{
"answer": "24 hours",
"isCorrect": false,
"explanation": "24 hours is the retention period for DynamoDB Streams records, not PITR."
},
{
"answer": "Until the on-demand backup is manually deleted",
"isCorrect": false,
"explanation": "This describes on-demand backups, not PITR. On-demand backups are full snapshots retained until explicitly deleted, while PITR provides a rolling 35-day continuous backup window."
}
]
},
{
"question": "A DynamoDB table uses provisioned capacity with Auto Scaling. The workload is normally predictable, but occasionally experiences sudden, large traffic spikes that exceed provisioned capacity before Auto Scaling can react. Which capacity mode would best handle this situation without manual intervention?",
"answers": [
{
"answer": "Switch to On-Demand capacity mode",
"isCorrect": true,
"explanation": "On-Demand mode scales instantly with traffic, handling unexpected spikes without any provisioning or warm-up delay. It is the best fit for workloads with unpredictable bursts, though at a higher per-request cost."
},
{
"answer": "Increase provisioned RCUs and WCUs to the peak possible load",
"isCorrect": false,
"explanation": "Over-provisioning wastes money during normal traffic. It also does not fully solve the problem if the peak is unpredictable or ever exceeds the provisioned limit."
},
{
"answer": "Enable DynamoDB Streams to buffer excess requests",
"isCorrect": false,
"explanation": "DynamoDB Streams captures change events for downstream processing. It does not buffer incoming write requests or help with throttling."
},
{
"answer": "Add a DAX cluster to absorb the extra read traffic",
"isCorrect": false,
"explanation": "DAX can reduce read pressure on the table, but it does not help with write spikes and does not solve the fundamental issue of provisioned capacity being exceeded."
}
]
},
{
"question": "Which of the following correctly describes the difference between a Local Secondary Index (LSI) and a Global Secondary Index (GSI) in DynamoDB? (Select TWO)",
"answers": [
{
"answer": "An LSI must be created at table creation time, whereas a GSI can be added or removed at any time",
"isCorrect": true,
"explanation": "This is a key operational difference. LSIs are immutable after table creation, while GSIs offer flexibility to be added or deleted on existing tables."
},
{
"answer": "An LSI has its own provisioned capacity, separate from the base table",
"isCorrect": false,
"explanation": "It's the GSI that has its own separate provisioned capacity. An LSI shares the provisioned capacity of the base table."
},
{
"answer": "A GSI always uses eventual consistency, whereas an LSI supports both strong and eventual consistency",
"isCorrect": true,
"explanation": "LSIs support strongly consistent reads because they share the same partition as the base table. GSIs replicate data asynchronously and are always eventually consistent."
},
{
"answer": "A GSI must use the same partition key as the base table",
"isCorrect": false,
"explanation": "This describes an LSI. A GSI uses a completely different partition key (and optional sort key), which is what makes it 'global'."
}
]
},
{
"question": "A developer uses `BatchWriteItem` to write 30 items to DynamoDB. The call returns successfully but some items appear in an `UnprocessedItems` list. What should the developer do?",
"answers": [
{
"answer": "Retry the entire batch from the beginning",
"isCorrect": false,
"explanation": "Retrying the full batch would re-write already processed items unnecessarily. Only the unprocessed items need to be retried."
},
{
"answer": "Retry only the items returned in `UnprocessedItems` using exponential backoff",
"isCorrect": true,
"explanation": "DynamoDB returns unprocessed items when the table is throttled or capacity is exceeded. The correct pattern is to retry only those items, using exponential backoff to avoid continued throttling."
},
{
"answer": "Switch to `TransactWriteItems` for the remaining items",
"isCorrect": false,
"explanation": "TransactWriteItems adds atomicity semantics and double the WCU cost. It is not the right tool for simply retrying unprocessed batch items."
},
{
"answer": "Ignore the `UnprocessedItems` as they will be automatically retried by DynamoDB",
"isCorrect": false,
"explanation": "DynamoDB does not automatically retry unprocessed items. The application is responsible for detecting and retrying them."
}
]
},
{
"question": "A company wants to allow users in both Europe and North America to read and write to a DynamoDB table with low latency, while ensuring data is available in both regions for disaster recovery. Which DynamoDB feature should be used?",
"answers": [
{
"answer": "DynamoDB Streams with a Lambda function replicating data cross-region",
"isCorrect": false,
"explanation": "While technically possible to build manual replication with Streams and Lambda, this approach is complex, error-prone, and introduces lag. DynamoDB Global Tables is the managed solution for this."
},
{
"answer": "DynamoDB Global Tables",
"isCorrect": true,
"explanation": "Global Tables provide fully managed multi-region, multi-active replication. Any region can accept reads and writes, changes propagate automatically, and it serves as built-in disaster recovery."
},
{
"answer": "Point-in-Time Recovery (PITR) enabled in both regions",
"isCorrect": false,
"explanation": "PITR is a backup and recovery feature, not a replication feature. It does not synchronize data across regions."
},
{
"answer": "Create identical tables in each region and use Route 53 latency-based routing",
"isCorrect": false,
"explanation": "Route 53 can route traffic to the nearest region, but manually maintaining data consistency across separate tables is not managed by AWS. Global Tables is the correct managed solution."
}
]
},
{
"question": "A developer notices that DynamoDB is throttling requests on a table where most writes target items with the same partition key value. What is the most likely root cause?",
"answers": [
{
"answer": "The table is using On-Demand capacity mode instead of Provisioned",
"isCorrect": false,
"explanation": "On-Demand mode scales automatically and is less prone to throttling. The root cause here is a data modeling issue, not a capacity mode issue."
},
{
"answer": "The partition key has low cardinality, creating a hot partition",
"isCorrect": true,
"explanation": "When many writes target the same partition key value, all traffic is routed to a single partition. This 'hot partition' exhausts its allocated throughput and causes throttling. A high-cardinality partition key distributes load evenly."
},
{
"answer": "The sort key is not defined, preventing DynamoDB from distributing data",
"isCorrect": false,
"explanation": "A sort key affects how items within a partition are ordered, not how data is distributed across partitions. Distribution is governed by the partition key."
},
{
"answer": "DynamoDB Streams is consuming too many RCUs",
"isCorrect": false,
"explanation": "DynamoDB Streams does not consume table read or write capacity. It operates independently."
}
]
},
{
"question": "Which of the following encryption options for DynamoDB at rest gives the customer full control over key rotation and the ability to audit key usage via AWS CloudTrail?",
"answers": [
{
"answer": "AWS owned key (default)",
"isCorrect": false,
"explanation": "AWS owned keys are managed entirely by AWS with no visibility to the customer. They cannot be audited via CloudTrail or controlled by the customer."
},
{
"answer": "AWS managed key (`aws/dynamodb`)",
"isCorrect": false,
"explanation": "AWS managed keys are visible in KMS but are managed by AWS. They offer some visibility but not full control over rotation or granular CloudTrail auditing of individual key usage."
},
{
"answer": "Customer managed key (CMK)",
"isCorrect": true,
"explanation": "CMKs give customers full control: they can define rotation policies, restrict key usage via IAM policies, and audit every use of the key in AWS CloudTrail. This comes at an additional KMS cost."
},
{
"answer": "Client-side encryption before writing to DynamoDB",
"isCorrect": false,
"explanation": "Client-side encryption is a valid security pattern, but it is not a DynamoDB encryption-at-rest option. The question specifically asks about DynamoDB's built-in encryption settings."
}
]
},
{
"question": "A developer needs to process DynamoDB change events in near-real-time using AWS Lambda, and also wants to retain the change records for up to 6 months for a compliance audit pipeline. Which architecture satisfies both requirements?",
"answers": [
{
"answer": "Enable DynamoDB Streams and trigger Lambda directly from the stream",
"isCorrect": false,
"explanation": "DynamoDB Streams only retains records for 24 hours. This cannot satisfy the 6-month retention requirement for the audit pipeline."
},
{
"answer": "Enable DynamoDB Streams, replicate to Kinesis Data Streams, trigger Lambda from Kinesis, and configure Kinesis retention up to 1 year",
"isCorrect": true,
"explanation": "Kinesis Data Streams supports up to 365 days of data retention and can trigger Lambda. By replicating DynamoDB Streams into Kinesis, you get both real-time Lambda processing and long-term retention for the compliance pipeline."
},
{
"answer": "Use PITR to replay changes over the past 6 months into Lambda",
"isCorrect": false,
"explanation": "PITR allows table restoration to a point in time. It does not provide a stream of individual change events suitable for Lambda invocation or audit pipelines."
},
{
"answer": "Schedule Lambda every minute to scan the DynamoDB table for new items",
"isCorrect": false,
"explanation": "Polling via Scan is expensive and unreliable — it cannot detect deletes or updates to existing items without complex logic, and it consumes significant read capacity."
}
]
}
]
{{< /qcm >}}