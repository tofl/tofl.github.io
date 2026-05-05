---
title: "Lambda Event Source Mapping: SQS vs Kinesis vs DynamoDB Streams"
---

## Lambda Event Source Mapping: SQS vs Kinesis vs DynamoDB Streams

AWS Lambda's event source mappings represent one of the most powerful yet frequently misunderstood aspects of building serverless applications. Rather than manually invoking Lambda functions, you can configure them to automatically trigger when messages arrive in SQS queues, records appear on Kinesis streams, or items are written to DynamoDB tables. But these three integration patterns are far from identical—each has distinct characteristics around polling behavior, message ordering, error handling, and scaling that can make or break your application architecture.

This guide walks you through the practical differences between these three event sources, examining how they poll for records, how they batch and parallelize work, and how they handle failures. By the end, you'll understand not just the mechanics of each integration, but also how to choose the right one for your specific use case.

### Understanding Event Source Mappings

Before comparing the three event sources, let's establish what an event source mapping actually does. It's essentially a configuration that sits between your event source and your Lambda function, continuously polling for new records and invoking your function with batches of those records. Lambda manages this entire process for you—you don't manually poll or manage the connection.

Think of it as a reliable mail carrier between your data source and your function. The mail carrier's job is to collect items (messages or records), bundle them together, and deliver them to your function. The key differences lie in how diligently the mail carrier collects items before delivery, how it handles packages that don't arrive at their destination, and whether it cares about the order in which items were originally placed in the mailbox.

### Polling Fundamentals Across All Three Sources

All three event sources rely on polling rather than push mechanisms. Lambda doesn't receive notifications when messages arrive—instead, it continuously asks "Are there any new messages for me?" at regular intervals. Understanding this fundamental behavior is crucial because it affects latency, costs, and how your system scales.

For **SQS**, Lambda polls the queue continuously, and you can control the polling frequency through the batch window and batch size parameters. By default, Lambda creates multiple concurrent poller connections (up to one per Lambda reserved concurrent execution), meaning it can retrieve multiple batches in parallel. When there are no messages available, Lambda still makes polling requests, but these consume no meaningful resources since you only pay for successful message processing.

For **Kinesis streams and DynamoDB Streams**, the polling mechanism is shard-aware. Lambda must track the current position (sequence number or stream record) on each shard and only retrieve records that come after that position. This is fundamentally different from SQS's queue model, because streams preserve ordering within a shard, and Lambda needs to respect that ordering as it processes records.

### Batch Size and Batching Windows

When multiple messages arrive rapidly, you have a choice: invoke the Lambda function with each individual message, or batch several messages together into a single invocation. Batching reduces the number of function invocations, which can lower costs and improve efficiency, but it increases latency because you're waiting to accumulate messages before processing.

The **batch size** parameter tells Lambda how many messages or records to include in a single function invocation. For SQS, the batch size can range from 1 to 10,000 messages. For Kinesis, it ranges from 1 to 10,000 records, and for DynamoDB Streams, it ranges from 1 to 1,000 records. These limits exist because of the general constraints on Lambda event payload sizes and invocation complexity.

The **batching window** (available for all three sources) introduces a time-based component. You can specify a window of 0 to 300 seconds. Lambda will wait up to this duration to collect more records before invoking the function, even if the batch size hasn't been reached. This is powerful for scenarios where you want to optimize batching but don't want to wait indefinitely. For example, you might set batch size to 100 and a batching window of 5 seconds, meaning Lambda will invoke your function either when 100 records have arrived, or 5 seconds have elapsed since the first record was seen, whichever comes first.

Consider a real-world scenario: you're processing order events from an e-commerce platform. With a batch size of 50 and a batching window of 2 seconds, Lambda can group up to 50 orders together, but if orders arrive slowly (say, only 20 per second during a quiet period), Lambda won't force you to wait 2.5 seconds for the batch to fill—it will invoke at the 2-second mark with whatever has arrived. During peak traffic, batches will fill quickly and invoke more frequently.

### Kinesis and DynamoDB Streams: Parallelization Factor

Here's where Kinesis and DynamoDB Streams introduce a critical concept that doesn't apply to SQS: the **parallelization factor**. This parameter (ranging from 1 to 10 for Kinesis, and 1 to 10 for DynamoDB Streams) controls how many concurrent Lambda invocations Lambda will create per shard.

By default (parallelization factor of 1), Lambda processes records from a shard sequentially. It retrieves a batch of records, invokes the function, waits for that invocation to complete, then retrieves the next batch. This ensures strict ordering of record processing within a shard. However, if your function has a 10-second latency, and each shard can deliver 1,000 records per second, you'll quickly fall behind.

Increasing the parallelization factor to, say, 5 means Lambda will create up to 5 concurrent invocations per shard, dramatically improving throughput. However, this comes at a cost: you lose strict sequential ordering within a shard. Records may be processed out of order across different invocations.

Imagine you're processing financial transactions on a Kinesis stream, and each customer's transactions are routed to the same shard to maintain ordering. With a parallelization factor of 1, transactions process in order: withdrawal, deposit, withdrawal. With a parallelization factor of 5, Lambda might invoke the function simultaneously with the first withdrawal and the deposit, and these could complete in any order, potentially violating your business logic.

This is why the parallelization factor requires careful consideration. Use it when you can tolerate out-of-order processing, or when records within a shard are independent and don't affect each other.

### Message Ordering and Guarantees

This is where the architectural differences become stark. **SQS provides no ordering guarantee**. Messages are intended to be processed in FIFO (first-in-first-out) order, but the standard SQS queue doesn't enforce this. If you send messages A, B, and C, Lambda might invoke your function with [A], then [C, B]. If strict ordering within a sequence is critical, you must use SQS FIFO queues, but even then, messages within the same message group will maintain order, but Lambda can still process them in parallel across different groups.

**Kinesis streams and DynamoDB Streams guarantee in-order processing within a shard**. Every record has a sequence number, and Lambda always processes records in ascending sequence number order within a shard. This is a fundamental property of streams and is extremely valuable for use cases where temporal ordering matters: user activity streams, clickstreams, time-series data, or any scenario where "what happened first" is meaningful.

If you have a user activity stream where events are routed to the same shard based on user ID, you're guaranteed that all events for that user will be processed in the exact order they occurred. This consistency is powerful and eliminates an entire class of race conditions that could otherwise plague your application.

### Error Handling Strategies: The Critical Differences

How event sources handle failures is arguably their most important distinguishing characteristic, because errors are inevitable in production systems.

#### SQS Error Handling

When your Lambda function fails to process an SQS message, Lambda returns an error, and the message's **visibility timeout** timer resets. The visibility timeout (default 30 seconds, configurable) determines how long the message remains hidden from other pollers. After the timeout expires, the message reappears in the queue and Lambda will attempt to process it again.

This mechanism is simple but has important implications. If your function fails, the message will be retried indefinitely (or until it reaches a maximum retry count, if configured through a dead-letter queue). Every time it fails, it goes back into the queue. If you're processing 100 messages in a batch and one fails, the entire batch fails, and all 100 messages become invisible, then visible again.

You can attach a dead-letter queue to your SQS source queue. Messages that fail after a maximum number of retry attempts (configurable per your Lambda's timeout and failure count) will be automatically sent to the dead-letter queue, removing them from the main processing flow. This prevents poison messages from clogging your pipeline indefinitely.

A practical example: you're processing payment notifications from a payment gateway via SQS. A malformed message arrives and causes your function to crash. With visibility timeout set to 60 seconds, that message will be retried after 60 seconds. If it still fails, it'll retry again 60 seconds later. After a few retries, it's sent to the dead-letter queue where your operations team can investigate. Meanwhile, valid messages continue to be processed normally.

#### Kinesis and DynamoDB Streams Error Handling

Streams use a fundamentally different error model. When a record fails, Lambda doesn't automatically retry it immediately. Instead, it stops processing that shard and enters an error state. You have two primary strategies to handle this: bisect on error, and on-failure destinations.

**Bisect on error** allows Lambda to automatically split the batch in half and retry each half separately. If a batch of 100 records fails, Lambda might split it into 50 + 50, invoke with the first 50, and if that still fails, split again into 25 + 25. This process continues until it either succeeds or reaches a single record. By recursively splitting, Lambda can isolate the problematic record and skip it, allowing processing to continue with the rest of the batch.

However, bisect on error doesn't discard failures—it just isolates them. For truly unprocessable records, you need **on-failure destinations**. These are SNS topics or SQS queues where Lambda automatically sends details about failed record batches. This gives you a mechanism to handle poison messages: instead of blocking the entire shard, failed batches are logged to the destination, and processing continues.

Here's a critical point: when an error occurs on a Kinesis shard with an event source mapping, Lambda's default behavior is to stop processing that shard until the issue is resolved. This is fundamentally different from SQS, where the queue continues to be polled regardless of failures. If a bad record lands in a Kinesis shard and you don't configure bisect on error or an on-failure destination, that shard stops processing entirely, and all subsequent records wait indefinitely.

For streams, a common pattern is to use a combination: enable bisect on error with a maximum of, say, 2 splits, and configure an on-failure destination. This way, Lambda tries to isolate the problematic record, but if it can't resolve the issue within 2 splits, it sends the batch details to the failure destination and moves on, preventing shard blocking.

### Scaling Behavior

Understanding how each source scales your Lambda function is essential for capacity planning.

**SQS scaling** is driven by the number of messages available. Lambda's scaling mechanism (part of the Lambda service managed by AWS) continuously polls SQS queues. If messages are waiting, Lambda scales up the number of concurrent pollers. The reserved concurrency setting on your Lambda function is a hard limit on how many invocations can happen concurrently. If you have 100 reserved concurrent executions, you can have at most 100 Lambda invocations running simultaneously. SQS polling scale adapts to this: if you have 100 reserved concurrent executions and a batch size of 10, you might have up to 10 concurrent pollers, each pulling a batch every few seconds.

Importantly, SQS scales independently of the number of messages. You don't partition messages across a queue—they all go into one queue (or message group in FIFO), and Lambda scales the polling as needed.

**Kinesis stream scaling** is shard-based. The number of shards in your stream determines maximum throughput. Each shard can deliver up to 1,000 records per second. If you have 10 shards, you have 10 units of parallel processing. Lambda creates one event source mapping per shard, so you can scale concurrency proportionally to the number of shards. If you auto-scale your Kinesis stream from 10 shards to 20 shards, Lambda automatically adapts and utilizes the additional shards for parallel processing.

**DynamoDB Streams scaling** works similarly. You don't explicitly create shards in DynamoDB Streams—they're created automatically based on the table's partitions and write throughput. Lambda adapts to the number of shards, creating concurrent processing for each shard based on your parallelization factor.

A practical comparison: suppose you expect 100,000 messages per hour with variable arrival patterns. With SQS, Lambda elastically scales from near-zero concurrent invocations during quiet periods to your maximum reserved concurrency during spikes. With Kinesis, you pre-provision shards: 100,000 messages per hour is about 28 messages per second, so you'd provision at least 1 shard (capable of 1,000 per second), but might provision 2-3 for headroom. Your scaling is more predictable but requires pre-planning.

### IAM Permissions Required

Each event source requires specific IAM permissions for Lambda to poll and process records.

For **SQS**, your Lambda execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:region:account-id:queue-name"
    }
  ]
}
```

The `ReceiveMessage` permission allows polling, `DeleteMessage` removes successfully processed messages, and `GetQueueAttributes` allows Lambda to determine queue depth for scaling.

For **Kinesis**, your Lambda execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "kinesis:GetRecords",
        "kinesis:GetShardIterator",
        "kinesis:DescribeStream",
        "kinesis:ListStreams",
        "kinesis:ListShards"
      ],
      "Resource": "arn:aws:kinesis:region:account-id:stream/stream-name"
    }
  ]
}
```

These permissions allow Lambda to retrieve records and track position within shards.

For **DynamoDB Streams**, your Lambda execution role needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:DescribeStream",
        "dynamodb:ListStreams",
        "dynamodb:ListShards"
      ],
      "Resource": "arn:aws:dynamodb:region:account-id:table/table-name/stream/*"
    }
  ]
}
```

Note that DynamoDB Streams permissions explicitly target the stream ARN, not the table itself.

### Decision Guide: Choosing Your Event Source

Choosing between these three is less about "which is best" and more about "which fits your requirements." Here's how to think through it:

**Choose SQS if** you're building a reliable task queue where messages can be processed in any order, you want simple error handling with dead-letter queues, or you need the flexibility to scale independently of pre-provisioned capacity. SQS is ideal for decoupling application components, request-response patterns, and scenarios where exactly-once processing is less critical than eventual consistency. E-commerce order queues, notification systems, and background job processing commonly use SQS.

**Choose Kinesis if** you're processing time-ordered data where sequence matters, you need sub-second latency between message production and consumption, or you're building real-time analytics pipelines. Kinesis is purpose-built for streaming data and excels at scenarios like clickstream processing, IoT sensor data aggregation, or financial transaction streams where the temporal relationship between events is meaningful.

**Choose DynamoDB Streams if** you need to react to changes in your DynamoDB table in real-time. A common pattern is to use a stream to trigger Lambda functions that update search indexes, send notifications when data changes, or maintain related data consistency across tables. DynamoDB Streams are tightly integrated with DynamoDB and require no additional infrastructure to enable.

Here's a concrete decision tree: Are you reacting to DynamoDB table changes? Use DynamoDB Streams. Do you need to preserve event ordering and process streaming data? Use Kinesis. Do you need a general-purpose queue with flexible error handling and no ordering requirements? Use SQS. If you're uncertain between Kinesis and SQS, start with SQS—it's simpler and more cost-effective unless you have specific requirements that demand Kinesis's streaming properties.

### Advanced Configuration Scenarios

In practice, many applications combine these approaches. You might use SQS to decouple a web service from a data pipeline, then use Kinesis internally within that pipeline for real-time analytics. Or you might attach a Lambda function to a DynamoDB Stream that performs validation and publishes validated events to an SQS queue for asynchronous processing.

Consider **maximum batching window** carefully. Setting it to 0 means Lambda invokes immediately when the batch size is reached, prioritizing low latency. Setting it to the maximum (300 seconds) prioritizes efficiency, batching more records together, but introduces latency. Most production systems find a sweet spot: perhaps 5-10 seconds for web-application-related processing, or 30-60 seconds for batch analytics workloads.

**Parallelization factor** on streams deserves attention in high-throughput scenarios. If your stream has 10 shards and your function takes 5 seconds per invocation, a parallelization factor of 1 means each shard can process at most 200 records per second (1,000 records / 5 seconds). Increasing to a parallelization factor of 5 multiplies this to 1,000 records per second per shard. The tradeoff is ordering: your function must be prepared to handle records potentially arriving out of order.

### Monitoring and Observability

Each event source exposes metrics you should monitor. For **SQS**, watch `ApproximateNumberOfMessagesVisible` (depth), `ReceiveCount` (retry attempts), and `ApproximateAgeOfOldestMessage` (oldest unprocessed message age). Rising message depth indicates you're not processing messages fast enough; high age suggests messages are stuck.

For **Kinesis and DynamoDB Streams**, monitor `GetRecords.IteratorAgeMilliseconds`, which measures how far behind the consumer is from the latest records. Rising age indicates your function can't keep up with incoming records. Also monitor `Lambda.OffendingProcessIdentifier` to identify which shard is causing problems.

Enable Lambda Insights to get visibility into function performance metrics. CloudWatch Logs are essential—log the number of records processed, processing time per record, and any errors. This data is invaluable for tuning batch sizes, parallelization factors, and identifying performance bottlenecks.

### Conclusion

Lambda event source mappings are powerful abstractions that handle the plumbing of connecting data sources to Lambda functions. But they're not one-size-fits-all. SQS excels at simple, flexible queuing; Kinesis shines for time-ordered, streaming data; and DynamoDB Streams provide tight integration with table changes.

When designing serverless systems, start by understanding your data flow. Does ordering matter? Are you reacting to events or queuing tasks? Do you have natural parallelization boundaries like DynamoDB partitions? The answers to these questions naturally point toward the right event source. Once you've chosen one, spend time tuning batch sizes and windows for your specific latency and throughput requirements. And always monitor—production workloads rarely perform exactly as expected, and observability is your best tool for optimization.

The beauty of building on AWS is that these three services integrate seamlessly. You might prototype with SQS for simplicity, switch to Kinesis for production requirements around ordering, or add a DynamoDB Stream to capture real-time changes. Understanding the nuances of each ensures you make those transitions deliberately and confidently.
