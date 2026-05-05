---
title: "EventBridge Archive and Replay: Building Auditable Event-Driven Systems"
---

## EventBridge Archive and Replay: Building Auditable Event-Driven Systems

Event-driven architectures have become the backbone of modern cloud applications, enabling loosely coupled, scalable systems where components communicate through events rather than direct calls. Yet with this flexibility comes a challenge: what happens when something goes wrong downstream, or when you need to bring a new service into the fold with historical context? Traditional request-response patterns let you retry a failed call, but events are ephemeral—by the time you realize a problem exists, the original event may be long gone. This is where AWS EventBridge's Archive and Replay feature becomes invaluable.

Archive and Replay transforms EventBridge from a simple event router into a system with memory and accountability. It allows you to capture events as they flow through your event bus, store them durably, and then selectively replay them at any point in the future. Whether you're debugging a production issue, recovering from a downstream service failure, or bootstrapping a brand-new microservice with historical data, this feature provides the foundation for building truly auditable and resilient event-driven systems.

### Understanding EventBridge Archives

At its core, an EventBridge archive is a time-based storage mechanism that captures events matching a specific pattern and retains them for a configurable period. Think of it as a detailed flight recorder for your event bus—it doesn't interfere with normal event flow, but it silently logs everything so you can review or replay it later.

When you create an archive on an event bus, you specify an event pattern that determines which events get captured. This pattern uses the same JSON-based matching syntax as EventBridge rules, so you can archive all events, just a specific type, or anything in between. For instance, you might archive all order events from your e-commerce system, or you might be more selective and archive only `OrderCancelled` events because those are particularly sensitive to processing order.

The archive itself doesn't interact with your rules or targets at all. Events flow through your normal rules and targets exactly as they would without an archive present. The archive operates independently, in parallel, capturing a copy of each matching event into durable storage. This separation means adding an archive to an event bus carries virtually no risk or performance penalty to your existing event processing.

### Creating an Archive with Filtering and Retention

Setting up an archive is straightforward. You specify a name for the archive, associate it with an event bus, and optionally provide an event pattern to filter which events get captured. If you don't provide a pattern, every event on that bus is archived—useful if you want a complete audit trail, though potentially expensive if your bus handles high volume.

Here's how you might create an archive for order events using the AWS CLI:

```bash
aws events put-event-bus-archive \
  --name order-events-archive \
  --event-source-arn arn:aws:events:us-east-1:123456789012:event-bus/default \
  --event-pattern '{"source": ["order.service"], "detail-type": ["Order Placed", "Order Cancelled"]}' \
  --retention-days 30
```

This archive captures any event with source `order.service` and detail types of either `Order Placed` or `Order Cancelled`, and retains them for 30 days. Once the retention period expires, archived events are automatically deleted, so you don't accumulate costs indefinitely.

The retention period is crucial to get right. Thirty days is a sensible default for many use cases—long enough to catch and debug issues, but short enough to keep storage costs reasonable. However, your mileage may vary. A financial services company might need 90 days or longer for compliance, while a fast-moving startup might only need a week. EventBridge charges per gigabyte-month for archived events, so think through your retention strategy upfront.

One common pattern is to use multiple archives on the same bus, each filtering for different event types and potentially having different retention periods. Your critical business events might be archived for 90 days, while less important events are archived for only 7 days. This gives you fine-grained control over your audit trail and costs.

### The Replay Mechanism

Replay is where archives become genuinely powerful. Once you've decided you need to reprocess some events, you initiate a replay operation specifying which archive to replay from, a time range (for example, "all events from yesterday between 2 PM and 4 PM"), and a destination. The destination can be a specific rule on your event bus or all rules—this distinction matters.

When you replay to a specific rule, EventBridge sends the replayed events only to that rule and its associated targets. This is useful when you know exactly which component failed and needs to reprocess data. If you want the replayed events to flow through your entire event bus as if they were being published fresh—matching against all rules—you replay to all rules instead.

Here's how you might replay a specific archive:

```bash
aws events start-replay \
  --name replay-order-events-20240115 \
  --event-bus-name default \
  --archive-name order-events-archive \
  --start-time 2024-01-15T14:00:00Z \
  --end-time 2024-01-15T16:00:00Z \
  --event-pattern '{"source": ["order.service"]}' \
  --state QUEUED
```

This command replays all archived events matching the source `order.service` that were captured between 2 PM and 4 PM on January 15th, 2024. The replay starts in a `QUEUED` state and progresses through `RUNNING` to `COMPLETED`. You can monitor its progress through the EventBridge console or by polling the API.

A critical detail: replayed events are indistinguishable from newly published events as far as your targets are concerned. Your Lambda functions, SQS queues, and SNS topics can't tell whether they're processing an original or replayed event unless you explicitly mark it somehow. This transparency is both a strength and something to be aware of—if you replay events without coordination, you might accidentally process duplicate orders or send duplicate notifications.

### Common Use Cases and Patterns

The Archive and Replay feature shines in several practical scenarios that developers encounter regularly in production systems.

**Debugging Production Issues** is perhaps the most immediate use case. Imagine a Lambda function that processes order events starts failing silently at 3 AM. By the time you wake up and notice, hundreds of orders have passed through the system. Rather than frantically trying to recreate the exact conditions, you replay the archived events from the failure window into a test environment where you can add verbose logging, inspect the function's behavior, and identify the root cause. Once you've fixed the bug, you replay the failed events again to production to ensure they're processed correctly.

**Recovering from Downstream Failures** is another common scenario. Suppose you have a complex workflow where order events flow through multiple services—an inventory system, a payment processor, and a shipping service. The payment processor goes down for an hour. During that time, EventBridge still routes events to it, but requests fail and get dead-lettered. Once the payment processor is back online, you can replay the events from the window when it was down, ensuring no orders fall through the cracks. The archive provides a buffer that abstracts away the need for each individual service to maintain its own retry mechanism.

**Bootstrapping New Microservices** is where Archive and Replay enables interesting architectural patterns. Imagine you're building a new analytics service that needs to process all historical orders. Rather than having the service poll a database or request a historical dump, you simply replay the last 90 days of order events directly to the analytics service. The service processes them as if they were happening in real-time, building its indices and state. Once the replay completes, new events flow to it continuously. This approach keeps your architecture event-centric and avoids special-case logic for "historical data."

**Compliance and Auditing** benefit significantly from archives. Regulatory requirements often demand that you maintain immutable records of business-critical events and be able to demonstrate that they were processed correctly. An EventBridge archive provides exactly this—a timestamped, durable record of every event that matched your criteria. You can prove that a customer's cancellation request was received at a specific time, that it was archived, and that it was replayed and processed on a particular date.

### Coordinating Replays in Production

While the feature is powerful, replaying events in production requires care. The most important principle is visibility and coordination. Before you initiate a replay, consider these questions: Are downstream systems idempotent, or could they process duplicate events? Have you notified your team that a replay is happening? Are you monitoring the targets to catch any unexpected issues?

One effective pattern is to add a custom attribute to replayed events marking them as such. Although EventBridge doesn't do this automatically, you can use a Lambda function as an intermediary that receives replayed events and enriches them with metadata before routing them to their final targets. Your downstream systems can then use this metadata to adjust their behavior if needed—perhaps applying different logging, skipping certain side effects, or triggering alerts.

```json
{
  "version": "0",
  "id": "abc123",
  "detail-type": "Order Placed",
  "source": "order.service",
  "account": "123456789012",
  "time": "2024-01-15T14:30:00Z",
  "region": "us-east-1",
  "resources": [],
  "detail": {
    "orderId": "ORD-12345",
    "customerId": "CUST-67890",
    "amount": 99.99,
    "isReplayed": true,
    "replayTime": "2024-01-16T10:15:00Z",
    "originalTime": "2024-01-15T14:30:00Z"
  }
}
```

This enriched event gives downstream systems full context. A service processing orders can check the `isReplayed` flag and adjust accordingly—maybe it skips sending a "New Order" email that was already sent originally, but still updates inventory counts.

### Understanding the Cost Model

EventBridge archives are billed based on the volume of events stored, measured in gigabytes per month. There's no charge for storing the archive structure itself, only for the events within it. The cost is typically modest—as of now, archives are priced at around $0.03 per GB-month in most regions—but with high-volume event buses, costs can accumulate.

To estimate costs, think about your event volume and average event size. If you publish 1 million events per day, each about 2 KB in size, that's roughly 2 GB of data per day, or 60 GB per month. At standard pricing, retaining that for 30 days would cost approximately $1.80 per month. That's negligible for most applications, but it's worth doing the math for your specific workload.

Replay operations themselves have no direct cost—you pay for the compute resources that process the replayed events (Lambda invocations, for instance), but not for the act of replaying. This makes the feature economical even if you replay large batches of events.

Cost optimization opportunities include being selective with your event patterns so you only archive what's truly necessary, and periodically reviewing your retention periods to see if they can be shortened without sacrificing operational needs. In some cases, you might have different archives for different event types with varying retention periods, allowing you to keep critical events longer while discarding less important ones sooner.

### Best Practices and Considerations

A few principles help ensure Archive and Replay serves you well in production. First, treat your archives as part of your disaster recovery strategy—ensure your archival strategy aligns with your recovery time objective (RTO) and recovery point objective (RPO). If you need to recover from a failure within an hour, you need archives that go back at least that far.

Second, test your replay process before you need it in anger. A well-designed drill—say, replaying a small batch of events to a staging environment monthly—ensures you understand the mechanics and can do it confidently when a real incident occurs.

Third, monitor your archives and track their growth over time. EventBridge provides CloudWatch metrics showing the number of archived events and other useful statistics. An unexpected spike in archived events might indicate a bug or misconfiguration upstream that's worth investigating.

Fourth, be explicit about idempotency in your event consumers. Because replayed events are identical to original events, only idempotent services can safely process them without causing problems. If you replay 1,000 events and each one triggers a debit to a customer's account, you'll have significant issues. Designing with idempotency in mind from the start—using event IDs as deduplication keys, for instance—makes Archive and Replay safe and powerful.

Finally, document your archive strategy. Record which events you're archiving, why, and for how long. Include this in your runbooks so that when an incident happens, the on-call engineer knows that archives exist and how to use them.

### Conclusion

EventBridge's Archive and Replay feature transforms event-driven architectures from brittle, ephemeral systems into durable, auditable, and recoverable platforms. By capturing events as they flow through your event bus and storing them durably, you gain the ability to debug issues, recover from failures, onboard new services, and maintain compliance—all without disrupting your normal event processing.

The feature is straightforward to set up, costs little to operate, and integrates seamlessly with EventBridge's existing rules and targets. Whether you're building a new event-driven system or improving an existing one, Archive and Replay should be part of your foundational design. It's the kind of feature that seems like a nice-to-have until you need it, and then you wonder how you ever built distributed systems without it.
