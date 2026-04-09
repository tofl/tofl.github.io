---
title: "12. SQS"
type: docs
weight: 2
---

## SQS (Simple Queue Service)

Amazon Simple Queue Service (SQS) is a fully managed message queuing service that lets you decouple the components of a distributed application. The core problem it solves is **temporal coupling**: without a queue, if a downstream service (consumer) is slow, overloaded, or temporarily unavailable, the upstream service (producer) either fails or has to wait. SQS breaks that dependency — producers drop messages into the queue and move on, consumers process at their own pace. [🔗](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/welcome.html)

### Standard vs FIFO Queues

SQS offers two queue types with fundamentally different guarantees:

- **Standard queues** offer maximum throughput (nearly unlimited transactions per second), but messages may be delivered out of order and occasionally more than once. This is fine for workloads that are idempotent and don't require strict ordering — think image thumbnail generation or sending notification emails.
- **FIFO queues** guarantee that messages are processed exactly once and in the exact order they are sent. Throughput is limited to 300 messages/second by default (or 3,000 with batching). Use FIFO when order matters — for example, sequencing financial transactions or state transitions. FIFO queue names must end with the `.fifo` suffix. [🔗](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-queue-types.html)

### Message Lifecycle

Understanding how a message moves through SQS is critical for both the exam and real-world usage:

1. **Send** — A producer calls `SendMessage`. The message enters the queue and becomes available (unless a delay is configured).
2. **Receive** — A consumer calls `ReceiveMessage`. SQS returns up to 10 messages and makes them *invisible* to other consumers for the duration of the **visibility timeout**.
3. **Delete** — The consumer explicitly calls `DeleteMessage` after successful processing. This permanently removes the message.
4. **Visibility timeout expiry** — If the consumer fails to delete the message within the visibility timeout window, the message becomes visible again and another consumer can pick it up. This is the mechanism behind at-least-once delivery.

The default visibility timeout is 30 seconds; it can be set between 0 seconds and 12 hours. [🔗](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-visibility-timeout.html)

#### Visibility Timeout and Lambda Timeouts — A Critical Interaction

When Lambda processes SQS messages, a subtle failure mode exists: **if your Lambda function times out before it finishes processing, it does not call `DeleteMessage`**. The visibility timeout then expires and the message reappears in the queue. To prevent this, always set your queue's visibility timeout to **at least 6× your Lambda function's timeout** — this gives Lambda time to finish and AWS's internal retry machinery enough headroom. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)

### Short Polling vs Long Polling

By default, `ReceiveMessage` uses **short polling**: SQS queries only a subset of its servers and returns immediately, even if the queue is empty. This wastes API calls and increases cost.

**Long polling** instructs SQS to wait up to 20 seconds for a message to arrive before returning an empty response. This is almost always the right choice — it reduces empty responses, lowers costs, and decreases latency for newly arrived messages. Enable it by setting `WaitTimeSeconds` (1–20) on the `ReceiveMessage` call, or set the queue's `ReceiveMessageWaitTimeSeconds` attribute. [🔗](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-short-and-long-polling.html)

### Dead-Letter Queues (DLQ) and maxReceiveCount

A Dead-Letter Queue is a separate SQS queue where messages are sent automatically after they've failed processing a configurable number of times. The threshold is controlled by **`maxReceiveCount`**: once a message has been received (and returned to the queue) that many times without being deleted, SQS moves it to the DLQ.

DLQs are invaluable for debugging — instead of losing failed messages, you can inspect them, fix the underlying bug, and replay them. A DLQ must be the same type as its source queue (Standard → Standard, FIFO → FIFO). You should always configure alarms on DLQ depth to detect processing failures early. [🔗](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html)

### Delay Queues and Per-Message Delay

You can postpone the delivery of new messages to a queue using a **delay queue** — setting `DelaySeconds` at the queue level (0–900 seconds). During this window the message is invisible to consumers.

For Standard queues, you can also override the delay on individual messages using the `DelaySeconds` message attribute, allowing per-message delivery scheduling. FIFO queues do not support per-message delays. [🔗](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html)

### Message Retention and Size Limits

- **Retention period**: Messages not consumed are retained for 1 minute to 14 days (default: 4 days). After this window, SQS automatically deletes them.
- **Maximum message size**: 256 KB. For larger payloads, store the data in S3 and pass a reference in the message — the [SQS Extended Client Library](https://github.com/awslabs/amazon-sqs-java-extended-client-lib) automates this pattern.

### FIFO-Specific Concepts

FIFO queues introduce two additional identifiers that control ordering and deduplication:

- **Message Group ID** — Groups related messages so they are processed one at a time, in order, within that group. Different groups can be processed in parallel. Think of it as a "lane": all orders for `customer-123` go in one lane, all orders for `customer-456` in another.
- **Message Deduplication ID** — A token SQS uses to deduplicate messages within a 5-minute window. If you send two messages with the same deduplication ID within that window, SQS delivers only one. You can supply this explicitly or enable **content-based deduplication**, which hashes the message body automatically. [🔗](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/FIFO-queues.html)

### SQS as a Lambda Trigger (Event Source Mapping)

SQS integrates with Lambda through an **event source mapping**: Lambda polls the queue on your behalf (you don't write polling code) and invokes your function with a batch of messages. Key configuration parameters:

- **Batch size** — How many messages Lambda retrieves per invocation (1–10,000 for Standard, 1–10 for FIFO).
- **Batch window** — For Standard queues, the maximum time (0–300 seconds) Lambda waits to accumulate a full batch before invoking. Useful for high-latency, batch-oriented workloads.
- **Partial batch failure reporting** — By default, if any message in a batch fails, the entire batch is retried. Enable `ReportBatchItemFailures` to let your function return only the failed message IDs, so successful messages aren't reprocessed. [🔗](https://docs.aws.amazon.com/lambda/latest/dg/with-sqs.html)

For FIFO queues, Lambda processes one message group at a time to maintain order, which limits parallelism.

### Access Control: Queue Policies vs IAM

SQS supports two complementary access control mechanisms:

- **IAM policies** — Attached to IAM identities (users, roles). Use these to grant AWS principals in *your own account* permission to interact with queues. This is the standard approach for services like Lambda or EC2 reading from a queue.
- **Queue resource-based policies** — Attached directly to the queue. Required when granting **cross-account access** or allowing AWS services like SNS to write to your queue. A common pattern: attach a queue policy that permits an SNS topic (in another account) to call `SendMessage`. [🔗](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-security-best-practices.html)

### Server-Side Encryption

SQS supports encryption at rest through two options:

- **SSE-SQS** — SQS manages the encryption keys for you. Zero configuration overhead, no extra cost.
- **SSE-KMS** — You provide a KMS Customer Managed Key (CMK), giving you control over key rotation, access auditing via CloudTrail, and cross-account key sharing. This option is required when you need fine-grained key access policies or regulatory compliance. [🔗](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-server-side-encryption.html)

Encryption in transit is always enforced via HTTPS endpoints.