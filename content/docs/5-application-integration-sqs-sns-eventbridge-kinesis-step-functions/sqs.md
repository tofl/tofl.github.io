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

{{< qcm >}}
[
{
"question": "A company uses Amazon SQS to decouple their order processing system. Occasionally, duplicate orders are being processed, causing inventory issues. The order of processing does not matter, but each order must be processed exactly once. Which SQS queue type should the team migrate to?",
"answers": [
{
"answer": "FIFO queue",
"isCorrect": true,
"explanation": "FIFO queues guarantee exactly-once processing, which prevents duplicate messages from being delivered. This directly addresses the duplicate processing issue."
},
{
"answer": "Standard queue with increased visibility timeout",
"isCorrect": false,
"explanation": "Increasing the visibility timeout reduces the chance of duplicate processing but does not eliminate it. Standard queues have at-least-once delivery semantics by design."
},
{
"answer": "Standard queue with a Dead-Letter Queue",
"isCorrect": false,
"explanation": "A DLQ handles failed messages, not duplicates. It does not provide exactly-once delivery guarantees."
},
{
"answer": "Standard queue with content-based deduplication enabled",
"isCorrect": false,
"explanation": "Content-based deduplication is a feature of FIFO queues, not Standard queues. It cannot be enabled on a Standard queue."
}
]
},
{
"question": "A developer is building a system where a Lambda function processes messages from an SQS Standard queue. The Lambda function has a timeout of 5 minutes. What is the minimum recommended visibility timeout for the SQS queue?",
"answers": [
{
"answer": "5 minutes",
"isCorrect": false,
"explanation": "Setting the visibility timeout equal to the Lambda timeout leaves no headroom for AWS's internal retry machinery. If Lambda takes its full timeout, the message will reappear before Lambda can delete it."
},
{
"answer": "30 minutes",
"isCorrect": true,
"explanation": "AWS recommends setting the visibility timeout to at least 6× the Lambda function timeout. With a 5-minute Lambda timeout, 6 × 5 = 30 minutes is the minimum recommended value."
},
{
"answer": "10 minutes",
"isCorrect": false,
"explanation": "10 minutes is only 2× the Lambda timeout, which is insufficient. The recommended multiplier is 6×."
},
{
"answer": "12 hours",
"isCorrect": false,
"explanation": "While 12 hours is technically valid (it is the maximum), it is far more than needed and would delay reprocessing unnecessarily if the Lambda truly fails."
}
]
},
{
"question": "An application sends messages to an SQS queue. A consumer reads a message and starts processing it, but crashes before finishing. What happens to the message?",
"answers": [
{
"answer": "The message is permanently deleted from the queue.",
"isCorrect": false,
"explanation": "Messages are only deleted when the consumer explicitly calls DeleteMessage. A crash before that call means the message is never deleted."
},
{
"answer": "The message becomes visible again in the queue after the visibility timeout expires.",
"isCorrect": true,
"explanation": "When a consumer receives a message, SQS makes it invisible for the duration of the visibility timeout. If DeleteMessage is not called before that window expires, the message becomes visible again and can be picked up by another consumer — this is the at-least-once delivery mechanism."
},
{
"answer": "The message is immediately sent to the Dead-Letter Queue.",
"isCorrect": false,
"explanation": "A message is only moved to the DLQ after it has been received and returned to the queue more times than the maxReceiveCount threshold. One failed attempt does not immediately trigger DLQ routing."
},
{
"answer": "The message stays invisible indefinitely.",
"isCorrect": false,
"explanation": "Visibility is temporary. Once the visibility timeout expires without a DeleteMessage call, the message becomes visible again."
}
]
},
{
"question": "A developer notices that their application is making many API calls to SQS but frequently receives empty responses, which is increasing costs. Which change should they make?",
"answers": [
{
"answer": "Switch from short polling to long polling by setting WaitTimeSeconds to a value between 1 and 20.",
"isCorrect": true,
"explanation": "Long polling instructs SQS to wait up to 20 seconds for a message before returning an empty response. This significantly reduces the number of empty responses and lowers API call costs."
},
{
"answer": "Increase the message retention period.",
"isCorrect": false,
"explanation": "Message retention controls how long unprocessed messages stay in the queue. It has no effect on the number of empty ReceiveMessage responses."
},
{
"answer": "Enable a Delay Queue with DelaySeconds set to 20.",
"isCorrect": false,
"explanation": "Delay queues postpone message delivery to consumers. They do not reduce empty polling responses."
},
{
"answer": "Increase the visibility timeout.",
"isCorrect": false,
"explanation": "The visibility timeout controls how long a message is hidden after being received. It does not affect whether polling returns empty responses."
}
]
},
{
"question": "A team is configuring a Dead-Letter Queue (DLQ) for their SQS FIFO queue. Which of the following statements are correct? (Select TWO)",
"answers": [
{
"answer": "The DLQ must also be a FIFO queue.",
"isCorrect": true,
"explanation": "A DLQ must be the same type as its source queue. A FIFO source queue requires a FIFO DLQ."
},
{
"answer": "The DLQ can be a Standard queue regardless of the source queue type.",
"isCorrect": false,
"explanation": "This is incorrect. The DLQ type must match the source queue type — Standard queues require a Standard DLQ, and FIFO queues require a FIFO DLQ."
},
{
"answer": "Messages are routed to the DLQ after exceeding the maxReceiveCount threshold.",
"isCorrect": true,
"explanation": "The maxReceiveCount setting defines how many times a message can be received without being deleted before SQS automatically moves it to the DLQ."
},
{
"answer": "The DLQ must be in a different AWS region than the source queue.",
"isCorrect": false,
"explanation": "There is no requirement for the DLQ to be in a different region. In fact, it is typically in the same region as the source queue."
}
]
},
{
"question": "A financial application uses an SQS FIFO queue to process transactions for multiple customers. The team wants transactions for different customers to be processed in parallel while maintaining strict ordering per customer. Which FIFO feature should they use?",
"answers": [
{
"answer": "Message Deduplication ID",
"isCorrect": false,
"explanation": "The Message Deduplication ID is used to prevent duplicate messages from being delivered within a 5-minute window. It does not control ordering or parallelism across customers."
},
{
"answer": "Message Group ID",
"isCorrect": true,
"explanation": "The Message Group ID groups related messages into a 'lane'. Messages within the same group are processed in order, one at a time. Different groups (e.g., different customers) can be processed in parallel, enabling per-customer ordering with cross-customer parallelism."
},
{
"answer": "Content-based deduplication",
"isCorrect": false,
"explanation": "Content-based deduplication hashes the message body to generate a deduplication ID automatically. It is unrelated to ordering or parallelism."
},
{
"answer": "Batch window",
"isCorrect": false,
"explanation": "The batch window controls how long Lambda waits to accumulate messages before invoking. It is a Lambda trigger setting and does not affect per-group ordering in FIFO queues."
}
]
},
{
"question": "A developer wants to send large payloads (up to 1 GB) through Amazon SQS. What is the correct approach?",
"answers": [
{
"answer": "Increase the SQS maximum message size in the queue settings.",
"isCorrect": false,
"explanation": "The SQS maximum message size is hard-capped at 256 KB. It cannot be increased beyond this limit."
},
{
"answer": "Store the payload in Amazon S3 and include the S3 reference in the SQS message, using the SQS Extended Client Library.",
"isCorrect": true,
"explanation": "For payloads larger than 256 KB, the recommended pattern is to store the data in S3 and pass a reference (S3 URL or key) in the SQS message. The SQS Extended Client Library automates this pattern."
},
{
"answer": "Split the payload into multiple messages and reassemble on the consumer side.",
"isCorrect": false,
"explanation": "While this is technically possible, it is complex, error-prone, and not the recommended AWS approach. The S3 reference pattern with the Extended Client Library is the standard solution."
},
{
"answer": "Use a FIFO queue, which supports larger message sizes.",
"isCorrect": false,
"explanation": "FIFO queues have the same 256 KB message size limit as Standard queues. Queue type does not affect the size limit."
}
]
},
{
"question": "A Lambda function processes messages from an SQS Standard queue in batches of 10. One message in a batch fails processing, but the other 9 succeed. By default, what happens?",
"answers": [
{
"answer": "Only the failed message is retried; the 9 successful messages are deleted.",
"isCorrect": false,
"explanation": "By default, SQS and Lambda do not have per-message failure awareness. The entire batch is retried if any message fails."
},
{
"answer": "The entire batch of 10 messages is retried.",
"isCorrect": true,
"explanation": "By default, if any message in a batch fails, Lambda does not delete any messages in the batch, causing all 10 to become visible again and be retried. This can lead to the 9 successful messages being processed multiple times."
},
{
"answer": "The failed message is immediately sent to the DLQ.",
"isCorrect": false,
"explanation": "A single failure does not immediately route a message to the DLQ. The message must exceed the maxReceiveCount threshold first."
},
{
"answer": "The batch is split: the 9 successful messages are deleted, and the failed message is retried.",
"isCorrect": false,
"explanation": "This behavior is only possible if the developer explicitly enables ReportBatchItemFailures. Without it, the entire batch is treated as a unit."
}
]
},
{
"question": "A developer enables ReportBatchItemFailures on a Lambda function triggered by an SQS queue. What is the benefit of this configuration?",
"answers": [
{
"answer": "Lambda will automatically fix and reprocess failed messages.",
"isCorrect": false,
"explanation": "ReportBatchItemFailures does not fix messages. It only allows Lambda to report which specific message IDs failed, so that only those are retried."
},
{
"answer": "Only the failed messages in a batch are returned to the queue for retry; successfully processed messages are not reprocessed.",
"isCorrect": true,
"explanation": "With ReportBatchItemFailures, the Lambda function returns the IDs of messages that failed. SQS then only makes those specific messages visible again, preventing successful messages from being redundantly reprocessed."
},
{
"answer": "Failed messages are immediately routed to the Dead-Letter Queue.",
"isCorrect": false,
"explanation": "ReportBatchItemFailures causes failed messages to return to the source queue for retry. They are only moved to the DLQ after exceeding maxReceiveCount."
},
{
"answer": "The batch size is automatically reduced to 1 after a failure.",
"isCorrect": false,
"explanation": "Batch size is not automatically adjusted based on failures. ReportBatchItemFailures only affects which messages are retried."
}
]
},
{
"question": "An SNS topic in Account A needs to send messages to an SQS queue in Account B. Which access control mechanism is required on the SQS queue?",
"answers": [
{
"answer": "An IAM policy attached to the SNS topic's role in Account A.",
"isCorrect": false,
"explanation": "IAM policies control what an identity can do, but they cannot grant cross-account access to resources in another account by themselves. A resource-based policy on the queue in Account B is also required."
},
{
"answer": "A queue resource-based policy on the SQS queue in Account B that allows the SNS topic to call SendMessage.",
"isCorrect": true,
"explanation": "Cross-account access and access from AWS services like SNS require a resource-based policy attached directly to the SQS queue. The policy must explicitly allow the SNS topic (identified by its ARN) to call SendMessage."
},
{
"answer": "An IAM role in Account B assumed by Account A.",
"isCorrect": false,
"explanation": "While cross-account IAM role assumption is a valid pattern in general, SNS publishing to SQS specifically requires a queue resource-based policy that permits the SNS service principal to call SendMessage."
},
{
"answer": "No additional configuration is needed; SQS allows cross-account access by default.",
"isCorrect": false,
"explanation": "SQS does not allow cross-account access by default. An explicit resource-based policy must be configured on the destination queue."
}
]
},
{
"question": "A company needs to comply with regulations requiring full control over encryption key rotation and access auditing for messages stored in SQS. Which encryption option should they choose?",
"answers": [
{
"answer": "SSE-SQS",
"isCorrect": false,
"explanation": "SSE-SQS is managed entirely by SQS and provides no control over key rotation or access auditing. It is suitable for basic encryption needs, not regulatory compliance requiring fine-grained key control."
},
{
"answer": "SSE-KMS with a Customer Managed Key (CMK)",
"isCorrect": true,
"explanation": "SSE-KMS with a CMK gives the customer full control over key rotation policies and enables access auditing through AWS CloudTrail. This is the correct choice when regulatory compliance or fine-grained key management is required."
},
{
"answer": "Client-side encryption before sending messages to SQS.",
"isCorrect": false,
"explanation": "While client-side encryption is possible, it is not an SQS server-side encryption option and would require the team to manage the encryption logic themselves. SSE-KMS is the AWS-native solution for this requirement."
},
{
"answer": "Enable HTTPS endpoints only — this is sufficient for compliance.",
"isCorrect": false,
"explanation": "HTTPS (encryption in transit) is always enforced by SQS but only protects data in motion. Encryption at rest for compliance requires SSE-KMS with a CMK."
}
]
},
{
"question": "A developer wants to delay the processing of all messages in an SQS Standard queue by 2 minutes after they are sent. How should this be configured?",
"answers": [
{
"answer": "Set the queue's DelaySeconds attribute to 120.",
"isCorrect": true,
"explanation": "Setting DelaySeconds at the queue level applies a delivery delay to all new messages. 120 seconds equals 2 minutes, which is within the allowed range of 0–900 seconds."
},
{
"answer": "Set the visibility timeout to 120 seconds.",
"isCorrect": false,
"explanation": "The visibility timeout controls how long a message is hidden after being received, not how long before it first becomes available. It is not the right mechanism for delaying initial delivery."
},
{
"answer": "Set WaitTimeSeconds to 120 on ReceiveMessage calls.",
"isCorrect": false,
"explanation": "WaitTimeSeconds enables long polling and can be at most 20 seconds. It controls how long the consumer waits for a message to arrive, not when the message becomes available."
},
{
"answer": "Configure a message retention period of 120 seconds.",
"isCorrect": false,
"explanation": "The retention period controls how long an unprocessed message stays in the queue before being deleted. It has no effect on when a message first becomes visible."
}
]
},
{
"question": "Which of the following statements about SQS FIFO queues are correct? (Select TWO)",
"answers": [
{
"answer": "FIFO queue names must end with the .fifo suffix.",
"isCorrect": true,
"explanation": "This is a hard requirement for FIFO queues. Without the .fifo suffix, the queue cannot be created as a FIFO queue."
},
{
"answer": "FIFO queues support per-message delays using the DelaySeconds message attribute.",
"isCorrect": false,
"explanation": "Per-message delays using the DelaySeconds attribute are only supported on Standard queues. FIFO queues do not support per-message delays."
},
{
"answer": "FIFO queues support up to 3,000 messages per second with batching.",
"isCorrect": true,
"explanation": "FIFO queues have a default throughput of 300 messages/second, which increases to 3,000 messages/second when using batching (up to 10 messages per batch)."
},
{
"answer": "FIFO queues guarantee at-most-once delivery for all messages.",
"isCorrect": false,
"explanation": "FIFO queues guarantee exactly-once processing (not just at-most-once), combined with strict ordering. At-most-once would mean messages could be lost, which is not accurate."
}
]
},
{
"question": "A Lambda function triggered by an SQS FIFO queue is processing messages. The team notices that throughput is much lower than expected. What is the most likely cause?",
"answers": [
{
"answer": "Lambda can only process 10 messages at a time from FIFO queues.",
"isCorrect": false,
"explanation": "The batch size limit for FIFO queues with Lambda is 10 messages, but this alone does not explain low throughput — the more fundamental cause is the per-group ordering constraint."
},
{
"answer": "Lambda processes one message group at a time to maintain order, limiting parallelism.",
"isCorrect": true,
"explanation": "For FIFO queues, Lambda maintains strict ordering by processing only one message group at a time. This inherently limits the level of parallelism compared to Standard queues where Lambda can scale concurrently across many messages."
},
{
"answer": "FIFO queues do not support Lambda as an event source.",
"isCorrect": false,
"explanation": "FIFO queues do support Lambda as an event source via event source mapping. Lambda processes one message group at a time to preserve ordering."
},
{
"answer": "The visibility timeout is too short, causing messages to be re-queued constantly.",
"isCorrect": false,
"explanation": "While a short visibility timeout could cause reprocessing, the question specifically points to unexpectedly low throughput, which is a characteristic behavior of FIFO queue's per-group ordering constraint with Lambda."
}
]
},
{
"question": "A message has been received from an SQS queue 4 times without being deleted. The queue has a maxReceiveCount of 3. Where is the message now?",
"answers": [
{
"answer": "The message remains in the source queue and will be retried indefinitely.",
"isCorrect": false,
"explanation": "Once a message exceeds the maxReceiveCount, SQS automatically moves it out of the source queue. It will not remain there for further retries."
},
{
"answer": "The message has been moved to the Dead-Letter Queue.",
"isCorrect": true,
"explanation": "Having been received 4 times, the message has exceeded the maxReceiveCount of 3. SQS automatically routes it to the configured Dead-Letter Queue for inspection and debugging."
},
{
"answer": "The message has been permanently deleted by SQS.",
"isCorrect": false,
"explanation": "SQS does not silently delete failed messages. Without a DLQ configured, the message would keep cycling in the source queue, but with a DLQ configured and maxReceiveCount exceeded, it is moved to the DLQ."
},
{
"answer": "The message is frozen and requires manual intervention to reprocess.",
"isCorrect": false,
"explanation": "There is no 'frozen' state in SQS. Messages either become visible again, are deleted, or are moved to a DLQ based on configuration."
}
]
},
{
"question": "Which of the following is a valid use case for an SQS Standard queue over a FIFO queue?",
"answers": [
{
"answer": "Processing financial transactions where the order of operations must be guaranteed.",
"isCorrect": false,
"explanation": "Financial transactions requiring strict ordering are a canonical use case for FIFO queues, not Standard queues."
},
{
"answer": "Sequencing state machine transitions that must happen in a specific order.",
"isCorrect": false,
"explanation": "State machine transitions requiring a specific order need FIFO guarantees. Standard queues offer no ordering guarantees."
},
{
"answer": "Generating image thumbnails where occasional duplicate processing is acceptable.",
"isCorrect": true,
"explanation": "Thumbnail generation is idempotent — processing the same image twice produces the same result with no side effects. Standard queues are ideal here given their near-unlimited throughput and the tolerance for duplicate delivery."
},
{
"answer": "Sending exactly-once notification emails to users.",
"isCorrect": false,
"explanation": "If exactly-once delivery is a hard requirement, a FIFO queue is needed. Standard queues may deliver messages more than once."
}
]
},
{
"question": "What is the maximum message retention period for Amazon SQS?",
"answers": [
{
"answer": "4 days",
"isCorrect": false,
"explanation": "4 days is the default retention period, not the maximum."
},
{
"answer": "7 days",
"isCorrect": false,
"explanation": "7 days is not the maximum retention period for SQS."
},
{
"answer": "14 days",
"isCorrect": true,
"explanation": "SQS supports a retention period between 1 minute and 14 days. The default is 4 days, but the maximum is 14 days."
},
{
"answer": "30 days",
"isCorrect": false,
"explanation": "30 days exceeds the maximum retention period. After 14 days, SQS automatically deletes unprocessed messages."
}
]
},
{
"question": "A developer wants to implement content-based deduplication for an SQS FIFO queue so that they do not have to manually assign a Message Deduplication ID. What does content-based deduplication use to detect duplicates?",
"answers": [
{
"answer": "A hash of the message metadata and attributes.",
"isCorrect": false,
"explanation": "Content-based deduplication hashes the message body, not the metadata or attributes."
},
{
"answer": "A SHA-256 hash of the message body.",
"isCorrect": true,
"explanation": "When content-based deduplication is enabled, SQS automatically generates a deduplication ID by hashing the message body using SHA-256. If two messages with the same body are sent within a 5-minute window, only one is delivered."
},
{
"answer": "The message's timestamp and sender identity.",
"isCorrect": false,
"explanation": "SQS does not use timestamps or sender identity for content-based deduplication. It uses a hash of the message body."
},
{
"answer": "A UUID generated at send time.",
"isCorrect": false,
"explanation": "A UUID would be unique per message and defeat the purpose of deduplication. Content-based deduplication uses a deterministic hash of the message body."
}
]
}
]
{{< /qcm >}}