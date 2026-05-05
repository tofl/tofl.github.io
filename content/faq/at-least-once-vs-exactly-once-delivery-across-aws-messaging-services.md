---
title: "At-Least-Once vs Exactly-Once Delivery Across AWS Messaging Services"
---

## At-Least-Once vs Exactly-Once Delivery Across AWS Messaging Services

Message delivery guarantees form the backbone of reliable distributed systems. When you send a message through an AWS service, you're implicitly asking a critical question: if something goes wrong, will my message be delivered once, more than once, or potentially not at all? The answer depends entirely on which service you're using and how you configure it.

This distinction matters profoundly in practice. A payment processing system tolerates at-least-once delivery only if consumers are idempotent—able to safely handle duplicate transactions. An analytics pipeline feeding a data warehouse might not care about duplicates if they're deduplicated upstream. A real-time notification system might accept rare duplicates as the cost of high availability. Understanding these tradeoffs, and knowing which AWS services provide which guarantees, is essential for building systems that are both reliable and appropriately engineered for their requirements.

This article maps the delivery guarantees across AWS's entire messaging and streaming ecosystem, explains what drives those guarantees, and shows how to design consumers that respect them.

### Understanding Delivery Semantics

Before diving into specific services, let's establish what we actually mean by delivery guarantees. There are three fundamental semantics in distributed messaging:

**At-most-once delivery** means a message will be delivered zero or one time. If the producer sends a message and the broker crashes before acknowledging receipt, the message is lost forever. This is rarely what you want in production systems, and few AWS services offer it as the default.

**At-least-once delivery** means a message will be delivered one or more times. The producer retries automatically if it doesn't receive acknowledgment, or the broker redelivers if the consumer doesn't confirm processing. This is the most common guarantee in AWS services. The tradeoff is clear: you're protected against loss, but consumers must handle duplicates gracefully.

**Exactly-once delivery** means each message is processed exactly once, no more, no less. This is the gold standard and the hardest to achieve, especially across the network boundary. It requires coordination between producer, broker, and consumer—typically through transactional semantics or idempotent operations combined with deduplication.

The challenge is that distributed systems are inherently unreliable. Networks partition, processes crash, and messages can be duplicated in transit. To deliver a guarantee, the system must detect and recover from these failures—and detection always introduces the possibility of duplication at some layer.

### Amazon SQS Standard: At-Least-Once Foundation

Amazon SQS Standard is the simplest entry point into AWS messaging. When you send a message to a standard queue, SQS stores it durably and waits for a consumer to receive it. Once the consumer processes the message and explicitly deletes it (via `DeleteMessage`), it's gone.

The delivery guarantee is **at-least-once**. SQS will keep a message available for consumption until a consumer deletes it or until the message expires. If a consumer receives a message, crashes before deleting it, and then restarts, that message will become available again and will be redelivered. This is straightforward and reliable.

Here's the practical implication: if you receive a message from SQS, you must assume it might be a duplicate. You should design your consumer logic to be idempotent—meaning processing the same message multiple times produces the same result as processing it once. For a transactional operation like money transfer, this might mean checking whether the transfer ID already exists before posting the transaction. For appending to a log or writing a unique record, you'd structure the write to either succeed or fail deterministically on retry.

SQS Standard has no built-in deduplication or ordering. It's optimized for high throughput and is perfectly appropriate when ordering and exact-once semantics aren't required. The visibility timeout parameter (default 30 seconds) controls how long a received message is hidden from other consumers—giving the first consumer time to process and delete it before it's redelivered.

### Amazon SQS FIFO: Exactly-Once Within Constraints

FIFO (First-In-First-Out) queues add two critical features: strict ordering and **exactly-once delivery within a five-minute deduplication window**. FIFO queues guarantee that messages are delivered in the order they were sent to the queue, and that each message with a unique deduplication ID will be processed exactly once.

Here's how it works. When you send a message to a FIFO queue, you provide a `MessageDeduplicationId`. If you send two messages with the same deduplication ID within a five-minute window, SQS will treat them as duplicates and will only deliver one. This means if a producer sends a message and doesn't receive the acknowledgment (but the message actually reached the queue), the producer can safely retry with the same deduplication ID, and the queue will ensure only one copy is processed.

The exactly-once guarantee comes with meaningful constraints. First, the deduplication ID must be unique per message, and you're responsible for generating it—often by hashing the message content or including a unique business identifier. Second, the five-minute window is fixed; if you retry after five minutes, you'll get a duplicate. Third, FIFO queues are significantly lower throughput than standard queues (up to 3,000 messages per second with batching), so they're suited to order-sensitive workloads rather than high-volume fire-and-forget scenarios.

A concrete example: an e-commerce order processing system where each order must be processed exactly once and in the order received. You'd generate a deduplication ID from the order ID, send the message with that ID, and let FIFO queue's exactly-once guarantee handle deduplication. If your order service retries, the queue will silently drop the duplicate.

### Amazon SNS: At-Least-Once with Fan-Out

Amazon SNS (Simple Notification Service) is a pub/sub service designed for one-to-many message delivery. A publisher sends a message to a topic, and SNS delivers it to all subscribed endpoints—which might be SQS queues, Lambda functions, HTTP endpoints, email addresses, or other services.

SNS guarantees **at-least-once delivery** to each subscriber. This means if you publish a message to an SNS topic, each subscriber will receive it at least once. However, in the event of a network hiccup or subscriber-side failure, SNS will retry, and you might end up with duplicates.

The implication is that every consumer of an SNS message should be idempotent. If an SNS message triggers a Lambda function that writes to a database, that Lambda should be written to handle being invoked multiple times with the same message—either by checking for existing records or by using upsert logic that's naturally idempotent.

One important architectural pattern: combining SNS with SQS. A common design is to publish to an SNS topic that fans out to one or more SQS queues. Each queue can then be processed by independent consumers. This gives you SNS's fan-out capability while adding the durability and independent processing semantics of SQS. SNS-to-SQS is a natural fit because both are at-least-once, so duplicates flow through cleanly—the important thing is that your SQS consumer is idempotent.

### Amazon Kinesis Data Streams: At-Least-Once with Checkpointing

Kinesis Data Streams is purpose-built for real-time data ingestion and processing. Unlike SQS, which is message-oriented, Kinesis is stream-oriented—you send records into a stream partitioned by shard, and consumers process them sequentially from each shard.

Kinesis guarantees **at-least-once delivery**. A record written to a stream will be available for any consumer to read, and Kinesis will retain it (by default for 24 hours, up to one year with enhanced retention). If a consumer reads a record and crashes before confirming it's processed, the record remains in the stream and can be read again when the consumer restarts.

The pattern for handling at-least-once delivery in Kinesis is checkpointing. The Kinesis Client Library (KCL) provides automatic checkpoint management: after processing a batch of records, it stores the shard sequence number you've read up to (the checkpoint). If the consumer crashes and restarts, it resumes reading from the last checkpoint, replaying any records it may not have fully processed. This ensures you don't lose records, but you do get at-least-once delivery—records near the checkpoint may be reprocessed.

To guarantee exactly-once semantics with Kinesis, you must make your consumer idempotent and store the sequence number you processed along with your business state. For example, if you're aggregating events into a DynamoDB table, you'd include the Kinesis sequence number in your record and check it before applying updates. This way, if you replay the same record twice, the second application is detected and skipped.

Kinesis is excellent for applications where throughput and latency matter more than strict ordering across the entire stream. Each shard processes records in order, but different shards are processed in parallel. For financial transactions or other order-dependent operations, you'd ensure all related records hash to the same shard, giving you ordering guarantees for that subset.

### AWS Lambda Async Invocations: At-Least-Once Retry

When you invoke a Lambda function asynchronously—whether through SNS, SQS, Kinesis, or direct `InvokeAsync` API calls—Lambda guarantees at-least-once invocation. If a function fails, Lambda automatically retries. The retry behavior depends on how you triggered it, but for asynchronous invocations, Lambda typically retries twice more after the first attempt, spread over several minutes.

Because Lambda async invocations are at-least-once, your function must be idempotent. If your function writes to a database or calls an external API, it should tolerate being called multiple times with the same event. For DynamoDB, you might use conditional writes; for external APIs, you'd check whether the operation already completed before retrying.

One nuance: Lambda async invocations can also be configured with a dead-letter queue (DLQ). If a function fails all retries, the original event can be sent to an SQS queue for later analysis or reprocessing. This adds durability but doesn't change the at-least-once guarantee for successful invocations.

### Amazon EventBridge: At-Least-Once Event Routing

EventBridge is AWS's serverless event bus. You send events to it, define rules that match events based on pattern, and route matched events to targets (Lambda functions, SNS topics, SQS queues, etc.).

EventBridge delivers events with **at-least-once semantics**. If an event matches a rule and is routed to a target, EventBridge will attempt delivery and retry on failure. If you have multiple targets for the same event, each target receives the event independently with at-least-once delivery.

From a consumer perspective, this means the same considerations as SNS: your event handlers must be idempotent. If an EventBridge rule routes events to a Lambda function that processes them, assume that function might be invoked multiple times with the same event.

EventBridge also has dead-letter queue support and filtering, which lets you shape the event flow before it reaches consumers. But the fundamental guarantee remains at-least-once—you're buying reliability and decoupling, not exactly-once delivery.

### Apache Kafka on AWS: Configurable, Up to Exactly-Once

AWS offers two managed Kafka services: Amazon MSK (Managed Streaming for Kafka) and Amazon Kinesis Data Streams API for Kafka. Both run Apache Kafka, which has configurable delivery semantics—the producer and consumer configurations determine what guarantee you actually get.

Kafka's default producer configuration (`acks=1`) gives at-least-once delivery. But you can tune it further. Setting `acks=all` ensures the broker waits for all replicas to acknowledge before considering a message committed, and setting `retries=-1` (unlimited retries) means the producer will keep trying until it succeeds or the session times out. Combined, these give you strong at-least-once semantics.

For exactly-once delivery with Kafka, you need both an idempotent producer and transactional processing. Kafka's idempotent producer (`enable.idempotence=true`) deduplicates messages on the broker side using a producer ID and sequence number—retries produce no duplicates. Transactions (using `isolation.level=read_committed` on consumers and `transactional.id` on producers) ensure that all messages within a transaction are processed atomically.

The configuration is complex and requires understanding of Kafka internals, but the payoff is real: you can achieve true exactly-once semantics where messages are processed once and only once, from ingestion through to consumer commit. This is why Kafka is popular for financial and compliance-heavy workloads.

From an AWS perspective, MSK gives you fully managed Kafka without the operational overhead of running Kafka yourself. Kinesis Data Streams for Kafka is a newer option that presents a Kafka-compatible API but uses Kinesis's underlying infrastructure.

### AWS Step Functions: Exactly-Once vs At-Least-Once Workflows

Step Functions orchestrates serverless workflows. It has two execution modes with different delivery semantics: Standard and Express.

**Standard workflows** provide **exactly-once execution semantics**. When you define a state machine and start an execution, Step Functions ensures that each state is executed exactly once unless you explicitly configure retries. If a Lambda function within a state fails, Step Functions will either retry it (if you configured a retry policy) or transition to a catch state (if you configured error handling)—but the execution progresses deterministically. Standard workflows are durable, can run for up to a year, and are audited in full—every state transition is logged.

**Express workflows** offer **at-least-once execution semantics** with higher throughput. Express workflows are optimized for high-volume, short-duration executions and use a different internal execution model that can process more executions per second. The tradeoff is that in rare failure scenarios, an Express workflow might execute a state multiple times. Express workflows have a 5-minute maximum duration and are intended for event-driven processing where idempotency is acceptable.

For critical workflows where each step must execute exactly once, use Standard workflows. For high-throughput event processing where duplicates can be tolerated or deduplicated downstream, Express workflows are more cost-effective.

### Quick Reference: Delivery Guarantees Across AWS Services

The table below summarizes the delivery semantics of major AWS messaging and streaming services:

| Service | Delivery Guarantee | Key Characteristic | Idempotency Required |
|---------|-------------------|-------------------|----------------------|
| SQS Standard | At-least-once | Message queue, high throughput | Yes |
| SQS FIFO | Exactly-once (5-min window) | Ordered, with deduplication ID | No |
| SNS | At-least-once | Pub/sub fanout | Yes |
| Kinesis Data Streams | At-least-once | Stream with shards, real-time | Yes |
| Lambda Async | At-least-once | Serverless compute invocation | Yes |
| EventBridge | At-least-once | Event bus with rules | Yes |
| MSK/Kafka | Configurable to exactly-once | Distributed streaming with transactions | Depends on config |
| Step Functions Standard | Exactly-once | Serverless workflow orchestration | No |
| Step Functions Express | At-least-once | High-throughput workflow | Yes |

### Designing Idempotent Consumers

Since most AWS messaging services default to at-least-once delivery, building idempotent consumers is a critical skill. Idempotency means processing the same message multiple times produces the same result as processing it once.

**The idempotency key pattern** is the foundational technique. When you process a message, extract or generate a unique identifier for that message and include it in your operation. For example, if you're processing an SNS message containing a payment request, extract the payment request ID and use it as the idempotency key. Before processing, check whether you've already applied this key—either by querying your database or by relying on the database's uniqueness constraints.

Here's a concrete pattern with DynamoDB. Imagine you're processing messages from SQS that instruct you to update a user's account balance:

```
def process_balance_update(message):
    update_id = message['updateId']
    user_id = message['userId']
    delta = message['delta']
    
    # Check if we've already processed this update
    response = dynamodb.get_item(
        TableName='ProcessedUpdates',
        Key={'updateId': {'S': update_id}}
    )
    
    if 'Item' in response:
        # Already processed, skip
        return {'statusCode': 200, 'body': 'Already processed'}
    
    # Process the update
    # This is where you'd increment the balance, charge a fee, etc.
    # For simplicity, we'll just record it.
    
    # Record that we've processed this update
    dynamodb.put_item(
        TableName='ProcessedUpdates',
        Item={'updateId': {'S': update_id}}
    )
    
    return {'statusCode': 200, 'body': 'Processed'}
```

This pattern ensures that even if the message is delivered multiple times, the second and subsequent deliveries are silently skipped because the idempotency key is already recorded.

For more advanced scenarios, you might use DynamoDB's conditional writes to combine the idempotency check and the business operation into a single atomic operation:

```
def atomic_balance_update(user_id, update_id, delta):
    dynamodb.update_item(
        TableName='Accounts',
        Key={'userId': {'S': user_id}},
        UpdateExpression='SET balance = balance + :delta, #updates = list_append(#updates, :update_id)',
        ConditionExpression='attribute_not_exists(#updates)',
        ExpressionAttributeNames={'#updates': 'processedUpdateIds'},
        ExpressionAttributeValues={
            ':delta': {'N': str(delta)},
            ':update_id': {'L': [{'S': update_id}]}
        }
    )
```

This way, if the balance update and the idempotency record fail to write together, the operation is rolled back and can be safely retried.

Another pattern is **database uniqueness constraints**. If you're inserting records based on messages, define a unique index on the message ID or idempotency key. If a duplicate message causes a duplicate insert, the constraint violation will signal the duplicate, and your code can catch the exception and proceed.

### Choosing the Right Service for Your Use Case

With so many options, how do you choose? The decision flow is roughly:

**Do you need exactly-once delivery semantics?** If yes, consider SQS FIFO (if ordering and low throughput are acceptable), Kafka on MSK (if you can manage the complexity), or Step Functions Standard (if you're orchestrating workflows). For most real-time streaming, at-least-once with idempotent consumers is more pragmatic.

**Is ordering important?** SQS FIFO and Kinesis (per-shard ordering) provide strong ordering guarantees. SNS and EventBridge have no ordering guarantees. If you need partial ordering within groups of messages, use SQS FIFO with message group IDs or Kinesis with partition keys.

**What's your throughput?** SQS Standard and Kinesis support very high throughput. SQS FIFO, SNS, and EventBridge have per-second limits but are generally sufficient for most applications. Kafka scales massively but adds operational complexity.

**Do you need fan-out?** SNS and EventBridge are built for one-to-many routing. SQS and Kinesis are one-to-many only through multiple consumers. If you need a single publisher to reach many independent consumers, SNS or EventBridge are natural choices.

**Is this a workflow or message queue?** If you're orchestrating multi-step operations with branching logic and complex state, Step Functions is purpose-built for it. For simple message passing, use SQS or SNS.

**Are you already using Kafka?** If your organization runs Kafka, MSK is a natural home for workloads that fit Kafka's model. If you're greenfield, AWS-native services are often simpler to operate.

### Common Pitfalls and How to Avoid Them

**Pitfall 1: Assuming at-least-once services provide exactly-once semantics without idempotency.** Many developers new to distributed systems expect SQS or SNS to magically deduplicate messages. They don't—you must design idempotent consumers. The service guarantees delivery; it's your job to handle duplicates gracefully.

**Pitfall 2: Not implementing consumer acknowledgment properly.** In SQS, you must explicitly call `DeleteMessage` after processing. Forgetting this means messages never get removed from the queue and keep getting redelivered. In Kinesis, the KCL handles checkpointing, but you need to ensure you're actually calling the checkpoint API after processing batches.

**Pitfall 3: Confusing delivery semantics with ordering guarantees.** Kinesis provides per-shard ordering but not global ordering across shards. SQS Standard has no ordering at all. You can have exactly-once delivery without ordering (and vice versa)—these are orthogonal concerns.

**Pitfall 4: Not testing failure scenarios.** Idempotency is easy to get wrong in practice. Write tests where you deliberately duplicate messages and verify that your consumer produces the same result. Use chaos engineering tools to inject failures and verify recovery.

**Pitfall 5: Configuring SQS FIFO deduplication window and then retrying outside of it.** If your producer retries after five minutes, the deduplication window has expired and you'll get a duplicate. Either keep retries within five minutes or use a different deduplication approach (like storing deduplication state in your application).

### Looking Forward: Transactional Outbox Pattern

As systems grow more sophisticated, a pattern called the **transactional outbox** becomes relevant. The idea is to store messages to be sent as part of your business transaction, then process them asynchronously. This ensures that if a business operation succeeds, the corresponding message will definitely be sent—no messages are lost due to application crashes.

Imagine updating an order and publishing an event. Instead of: (1) update order, (2) publish event, you do: (1) update order and insert a row in an "outbox" table as a single transaction, then (2) a separate process reads outbox entries and publishes them. If step 1 succeeds but step 2 crashes, the outbox row is still there, and a retry will pick it up. This pattern provides exactly-once semantics by shifting the guarantee from the messaging service to your application's transaction log.

Implementing this with AWS typically involves DynamoDB or RDS for the outbox table and Lambda or Kinesis for the consumer that processes the outbox.

### Conclusion

AWS's messaging and streaming services each embody different delivery semantics, and choosing wisely depends on understanding what those guarantees actually mean and what they cost. Most services provide at-least-once delivery, which is reliable and performant but requires idempotent consumers. A few—SQS FIFO, Kafka with transactions, and Step Functions Standard—provide exactly-once semantics, though usually with constraints or complexity.

The key insight is that delivery guarantees and idempotency are two sides of the same coin. A service that guarantees at-least-once delivery is promising you won't lose messages, but it's also saying you might see duplicates—and that's fine as long as your consumer can handle them. Understanding this distinction and building consumers that respect it is what separates robust systems from fragile ones.

When you're designing a messaging architecture, start by asking: what if this message is delivered twice? If your system breaks, you haven't understood your service's guarantee. If your system handles it gracefully, you've built something that will survive the real, messy world of distributed systems.
