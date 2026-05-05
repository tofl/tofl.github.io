---
title: "DynamoDB Capacity Calculations: RCU and WCU Worked Examples for the Exam"
---

# DynamoDB Capacity Calculations: RCU and WCU Worked Examples for the Exam

If you've worked with DynamoDB, you've likely encountered the capacity planning question: "How many read and write capacity units do I actually need?" The answer lies in understanding how AWS bills for reads and writes—and it's more nuanced than simply dividing item size by block size. Get the calculation wrong in a production scenario, and you'll either overpay or face throttled requests. Get it wrong on the exam, and you'll miss points that are directly testing your understanding of how DynamoDB pricing works.

This article walks you through the exact mechanics of RCU and WCU calculations, complete with the rounding rules that trip up most developers. We'll cover the differences between strongly consistent and eventually consistent reads, the doubling cost of transactional operations, and how batch operations actually charge you per item, not per request. By the end, you'll not only pass the capacity calculation questions on the exam—you'll understand why these rules exist and how to apply them confidently in real scenarios.

### Understanding the Foundational Unit: What Is a Capacity Unit?

Before you can calculate capacity, you need to know what you're measuring. A read capacity unit (RCU) is not a fixed amount of data; it's a unit of *throughput*. One RCU grants you one strongly consistent read per second of items up to 4 KB in size. Similarly, one write capacity unit (WCU) grants you one write per second of items up to 1 KB in size.

The crucial detail here is the block size. DynamoDB doesn't charge you based on the actual size of your item in isolation—it rounds up to the nearest multiple of the block size. For reads, that block is 4 KB. For writes, it's 1 KB. If you write a 2.5 KB item, you pay for 3 KB of write capacity. If you read a 3 KB item, you pay for 4 KB of read capacity.

This rounding behavior is fundamental to every capacity calculation you'll encounter. Ignore it, and your math will be off.

### The Read Capacity Unit: Strongly Consistent vs Eventually Consistent

DynamoDB offers two read consistency models, and they have different capacity costs.

A strongly consistent read returns the most recent version of an item, with the guarantee that DynamoDB has written it to all replicas. This consistency comes at a price: one RCU buys you exactly one strongly consistent read per second of items up to 4 KB. A 5 KB item would require two RCUs (rounded up to 8 KB), and a 7 KB item would also require two RCUs (again, rounded to 8 KB).

An eventually consistent read, by contrast, may return an older version of an item while writes are propagating across replicas. DynamoDB charges half the capacity for this trade-off: one RCU buys you two eventually consistent reads per second of items up to 4 KB. The same 5 KB item now costs only one RCU (since 5 KB rounds to 8 KB, and 8 KB ÷ 4 KB × 0.5 RCU = 1 RCU). This makes eventually consistent reads attractive for scenarios where stale data is acceptable, such as reading a product catalog or user preference cache.

The decision between these two models depends entirely on your use case. Real-time financial transactions demand strong consistency. A leaderboard in a game? Eventually consistent is perfectly fine and cuts your capacity costs in half.

### Write Capacity Units: The Simpler Calculation

Writes are more straightforward than reads. One WCU buys you one write per second of items up to 1 KB. The rounding block is 1 KB, meaning a 1.5 KB item costs 2 WCUs, and a 6.3 KB item costs 7 WCUs. There's no eventually consistent option for writes; DynamoDB always writes to all replicas before confirming the write to your application.

Importantly, the cost applies to the *item* being written, not the operation itself. Whether you use a PutItem, UpdateItem, or DeleteItem call, you pay based on the size of the item. A DeleteItem operation that removes a 5 KB record costs 5 WCUs. An UpdateItem that modifies only an attribute within a 10 KB item costs 10 WCUs—you're still writing the entire item.

This distinction becomes critical when you're optimizing for cost. If you have large items that you rarely modify, you might consider splitting them into multiple smaller items to reduce write costs.

### Transactional Operations: The 2x Multiplier

DynamoDB's transactional API—TransactReadItems and TransactWriteItems—provides ACID guarantees across multiple items, but at a cost. Transactional reads and writes consume twice the capacity units of their non-transactional equivalents.

If a strongly consistent read of a 3 KB item normally costs 1 RCU, the same read within a transaction costs 2 RCUs. A write of a 2 KB item normally costs 2 WCUs; within a transaction, it costs 4 WCUs. This doubling applies per item in the transaction, so a TransactWriteItems call affecting three items will incur the transaction overhead for all three.

The reason for this cost is straightforward: DynamoDB must coordinate writes across partitions, maintain isolation, and potentially roll back failed items. The infrastructure cost is genuinely higher, and AWS bills accordingly. This is why transactional operations are best used sparingly, for scenarios where atomicity is non-negotiable—updating an inventory count and a sales record together, or transferring funds between accounts.

### Batch Operations: Per-Item Billing, Not Per-Batch

A common misconception among developers new to DynamoDB is that batch operations—BatchGetItem and BatchWriteItem—have different capacity costs than individual operations. They don't. You pay per item, not per batch.

If you call BatchGetItem to read ten 2 KB items with strong consistency, you pay 10 RCUs (since each 2 KB item rounds to 4 KB, costing 1 RCU each). Calling GetItem ten times instead would cost the same 10 RCUs. The batch API is valuable for reducing latency—DynamoDB processes items in parallel—but not for reducing capacity costs. You might batch items to reduce the number of network round trips, but the capacity meter ticks at the same rate.

One nuance: BatchWriteItem and BatchGetItem have size limits and can return partially successful results. If you batch 25 items but the request exceeds 16 MB or DynamoDB throttles you mid-request, only the successfully processed items consume capacity. This is why it's important to handle partial batch results in your application logic.

### Worked Example 1: Reading Multiple Items with Strong Consistency

Let's say your application needs to fetch 100 user profiles, each averaging 6 KB in size, with strong consistency. How many RCUs do you need per second?

First, calculate the capacity per item. Each 6 KB item rounds up to 8 KB. One strongly consistent read of an 8 KB item costs 8 KB ÷ 4 KB = 2 RCUs.

Next, multiply by the number of items: 100 items × 2 RCUs per item = 200 RCUs per second.

If your application needs to support this load continuously, you'd provision 200 RCUs on your table. If this is a spike that happens only occasionally, you might use DynamoDB's on-demand billing mode instead, which charges per request rather than a fixed capacity.

### Worked Example 2: Writing Items and Calculating Burst Capacity

Imagine you're building a logging system that writes 500 events per second to DynamoDB, each event averaging 2.5 KB. How many WCUs do you need?

Each 2.5 KB item rounds up to 3 KB (the next multiple of 1 KB). This costs 3 WCUs per write.

For 500 writes per second: 500 × 3 WCUs = 1,500 WCUs per second.

Now consider DynamoDB's burst capacity. AWS allocates unused capacity from the previous five minutes as burst capacity, allowing you to handle brief spikes. If your table is lightly used most of the time, you might provision a lower steady-state capacity—say, 1,000 WCUs—and rely on burst capacity to handle the spikes. However, this is risky; if the spike lasts longer than a few seconds or you've already consumed your burst allowance, requests will be throttled.

For a consistent 500 writes per second, provisioning exactly 1,500 WCUs is the safest approach.

### Worked Example 3: Strongly Consistent vs Eventually Consistent Cost Comparison

Your analytics dashboard displays user activity trends. The data must be recent but doesn't need to be perfectly current—a few seconds old is acceptable. You need to read 50 items averaging 8 KB each, ten times per second. Compare the capacity costs of strongly consistent vs eventually consistent reads.

**Strongly consistent approach:**

Each 8 KB item costs 8 KB ÷ 4 KB = 2 RCUs. With 50 items read ten times per second, that's 50 × 2 × 10 = 1,000 RCUs per second.

**Eventually consistent approach:**

Each 8 KB item costs (8 KB ÷ 4 KB) × 0.5 = 1 RCU. With 50 items read ten times per second, that's 50 × 1 × 10 = 500 RCUs per second.

By switching to eventual consistency, you've cut your capacity costs in half. This is a significant saving, and it's why many read-heavy applications default to eventual consistency and only use strong consistency where necessary.

### Worked Example 4: Transactional Writes with Mixed Item Sizes

You're building an e-commerce platform. When a customer places an order, you need to atomically update the order record (4 KB), decrement the inventory count (1 KB), and record a transaction fee (0.5 KB). Using TransactWriteItems, what's the capacity cost?

First, calculate the WCU per item:
- Order record: 4 KB rounds to 4 KB = 4 WCUs
- Inventory count: 1 KB rounds to 1 KB = 1 WCU
- Transaction fee: 0.5 KB rounds to 1 KB = 1 WCU

Total: 4 + 1 + 1 = 6 WCUs.

But wait—this is a transactional write, so you double the cost: 6 × 2 = 12 WCUs per transaction.

Now contrast this with three individual UpdateItem calls: you'd pay 4 + 1 + 1 = 6 WCUs total with no doubling. The transactional cost is twice as high. This is the trade-off: you gain atomicity, but you pay for the privilege. If the consistency guarantee is essential—which it typically is in e-commerce—the cost is justified. If you could accept eventual consistency between the three updates, the individual calls would be more efficient.

### Worked Example 5: Batch Operations and Partial Failures

Your application batches 25 items for deletion using BatchWriteItem. Each item averages 3 KB. How many WCUs are consumed, and what happens if only 20 items succeed?

Each 3 KB item rounds to 3 KB = 3 WCUs per write.

If all 25 items succeed: 25 × 3 = 75 WCUs consumed.

If only 20 items succeed (perhaps due to throttling or a validation error): 20 × 3 = 60 WCUs consumed. You only pay for what actually writes.

This is why batch operations return detailed per-item success/failure information. Your application code must check the response and retry failed items, because partial failures are possible and expected under load.

### Quick-Reference Cheat Sheet for Capacity Calculations

**Read Capacity Units (RCUs):**
- Strongly consistent read: item size rounded up to nearest 4 KB, divided by 4 KB per RCU
- Eventually consistent read: same calculation, then multiply by 0.5
- Formula: ((item size + 4 KB - 1) / 4 KB) × RCU per block × consistency multiplier

**Write Capacity Units (WCUs):**
- Any write operation: item size rounded up to nearest 1 KB = WCUs
- Formula: ((item size + 1 KB - 1) / 1 KB) × 1 WCU

**Transactional Modifiers:**
- TransactReadItems: RCU cost × 2
- TransactWriteItems: WCU cost × 2

**Batch Operations:**
- Capacity cost = sum of per-item costs (no batch discount)
- Billing applies only to successfully processed items

**Provisioning Guidelines:**
- Calculate peak load, not average load
- Account for rounding; few items are perfectly 4 KB or 1 KB aligned
- Consider eventual consistency for read-heavy workloads to cut costs in half
- Use on-demand billing for unpredictable or bursty workloads
- Monitor CloudWatch metrics (ConsumedReadCapacityUnits, ConsumedWriteCapacityUnits) to validate your calculations

### Capacity Planning in Practice: What the Exam Expects

When you encounter a capacity calculation question on the exam, the examiners aren't testing your mental math. They're testing whether you understand the rounding rules, the consistency model differences, and the transaction cost multipliers. These are the core billing mechanics of DynamoDB, and getting them right is essential to making sound architectural decisions in production.

A typical exam question might ask: "You need to read 200 items averaging 5 KB each with eventual consistency, fifty times per hour. Which provisioned capacity is sufficient?" Work through it step by step. Five KB rounds to 8 KB. Eight KB divided by 4 KB per RCU is 2 RCUs per item, but eventual consistency halves it to 1 RCU per item. Two hundred items times 1 RCU is 200 RCUs, but that's per read operation. Fifty reads per hour is less than one per second, so 200 RCUs provisioned per second is vastly overkill—you could provision far less. The examiners want to see that you work through each step and understand what each multiplier represents.

### Conclusion

DynamoDB capacity calculations boil down to understanding block sizes (4 KB for reads, 1 KB for writes), consistency models (strongly consistent is full price, eventually consistent is half), and cost multipliers (transactional operations double the cost). These aren't arbitrary rules; they reflect the actual infrastructure costs DynamoDB incurs to provide different guarantees. Strongly consistent reads must check multiple replicas, so they cost more. Transactional operations require coordination and rollback logic, justifying the doubling.

Master these calculations, and you'll not only answer exam questions confidently but also make better architectural decisions in real projects. You'll know when to switch to eventually consistent reads to cut costs, when transactional writes are worth the premium, and how to estimate the capacity needed for your workload without overpaying or getting throttled. That foundation of understanding will serve you throughout your career working with DynamoDB.
