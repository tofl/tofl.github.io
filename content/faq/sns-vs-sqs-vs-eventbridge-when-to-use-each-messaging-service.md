---
title: "SNS vs SQS vs EventBridge: When to Use Each Messaging Service"
---

## SNS vs SQS vs EventBridge: When to Use Each Messaging Service

Choosing the right messaging service is one of the most consequential architectural decisions you'll make in AWS. Get it wrong, and you'll end up with a system that's inefficient, expensive, or worse—unable to scale when it matters most. The good news? AWS gives you three powerful options, each optimized for different communication patterns. The challenge is understanding when to reach for each one.

In this article, we'll move beyond surface-level definitions and build real intuition about SNS, SQS, and EventBridge. By the end, you'll be able to recognize a scenario—whether it's a batch job that needs distribution, an order that needs to trigger multiple systems, or a complex event routing problem—and confidently select the right service.

### Understanding the Three Messaging Patterns

Before we compare services, let's establish the three fundamental messaging patterns they support.

**Point-to-point messaging** involves a single producer sending a message that should be processed by exactly one consumer. Think of it like sending a letter to a specific person—you want it to reach exactly one destination. The producer doesn't need to know or care who consumes the message; it just needs to know that work will get done. This is where you queue messages for processing.

**Publish-subscribe messaging** flips the model. A single producer publishes an event, and multiple subscribers independently receive a copy of that event. It's like posting an announcement on a bulletin board—anyone interested can grab a copy. The producer has no idea who's listening, and new subscribers can tune in anytime. Each subscriber gets its own independent copy of the message.

**Event-driven routing** goes further by adding sophisticated filtering and pattern matching. Multiple subscribers can listen for events, but they only receive messages that match specific criteria they've defined. It's like a sophisticated notification system where you can subscribe to "all orders over $100 from New York" rather than just "all orders."

These patterns aren't academic abstractions—they directly determine how your systems interact and scale.

### Amazon SQS: The Reliable Queue

SQS is the workhouse of AWS messaging. It's a fully managed queue service that guarantees every message you put in will be processed exactly once (when using the right configuration), and it's been handling millions of messages per second across AWS for years.

**How SQS works** is straightforward. A producer sends messages to a queue, and consumers poll that queue, receive messages, and delete them after processing. It's point-to-point—each message is intended for one consumer, even though multiple consumers might be reading from the same queue. If Consumer A picks up a message, Consumer B won't see it. This is fundamentally different from pub/sub.

SQS comes in two flavors: **Standard queues** and **FIFO queues**. Standard queues offer maximum throughput and best-effort ordering—messages *usually* arrive in the order sent, but AWS makes no guarantees. They're incredibly cheap and perfect when ordering doesn't matter. FIFO queues guarantee strict message ordering and exactly-once processing, which costs more per request but is essential for systems where sequence matters, like financial transactions or critical state changes.

The latency characteristics of SQS are worth understanding. Messages are immediately available in the queue, but consumers must poll for them. Polling can happen very frequently (up to every millisecond with long polling enabled), so from a practical standpoint, end-to-end latency is quite good—usually sub-second. However, there's always a small gap between when a message arrives and when a consumer checks for it.

SQS shines for **batch job distribution**. Imagine you have a video transcoding system. Upload jobs get queued in SQS, and you can autoscale your fleet of transcoding workers based on queue depth. Each job goes to exactly one worker, and if that worker fails partway through, the message becomes visible again after a timeout (the visibility window) and another worker picks it up. This pattern is rock-solid.

**Cost** for SQS is per million requests. A request can include up to 10 messages (for batch operations), so you pay for batches of messages, not individual messages. At scale, this becomes very economical. For a high-throughput system processing millions of messages daily, SQS is often the cheapest option.

The message size limit is important: SQS supports messages up to 256 KB. For larger payloads, you can store the actual data in S3 and put just the reference in the queue. SQS itself remains lightweight and fast.

### Amazon SNS: The Publisher Broadcaster

SNS is a fully managed pub/sub service where producers publish messages to a topic, and any subscriber to that topic receives a copy. The magic is that the producer never needs to know how many subscribers exist or what they'll do with the message.

**The subscription model** is where SNS differs fundamentally from SQS. When you publish a message to an SNS topic, all active subscriptions receive a copy, independently and immediately. If the topic has no subscribers, the message is simply lost—SNS doesn't queue or persist messages for future subscribers. This is crucial: SNS is not a queue.

A single SNS topic can have many subscriber types simultaneously. You might have SQS queues as subscribers, Lambda functions as subscribers, HTTP endpoints, email addresses, and mobile push notifications all listening to the same topic. Each gets its own copy. This is the fan-out pattern—one publish, many receivers.

**Latency** with SNS is excellent for pub/sub. Once you publish, subscribers are notified almost immediately, typically within milliseconds. There's minimal delay.

**Filtering** in SNS is basic but functional. You can define subscription filters using a simple JSON format that matches on message attributes. For example, you could filter on `{"store": ["NYC"]}` to only receive messages with that attribute. However, SNS filtering is attribute-based and relatively flat compared to more complex routing needs.

**Cost** is per million publish requests. Each time you publish a message, you're charged. If one publish goes to a topic with five SQS queue subscriptions, that's one charge. The subscribers themselves don't incur additional charges from SNS—the SQS queues will charge you for their own messages, but SNS isn't a per-subscription cost.

SNS works exceptionally well for **multiple systems reacting to an event**. Consider an e-commerce system where an order is placed. You need the order service to update the database, the payment service to charge the customer, the fulfillment service to pick and ship items, and the analytics service to log the event. Rather than the order service calling each of these directly (creating tight coupling), publish an `OrderPlaced` event to an SNS topic. Each service subscribes to that topic independently. If you later need to add a marketing service that sends a confirmation email, you just add a new subscription—no changes to the order service.

One thing to watch: SNS subscriptions to SQS queues create a fan-out pattern where the same message appears in multiple queues. This is useful for fanout but means you pay for both the SNS publish and each message that lands in SQS. It's still often the right pattern, but it's worth being aware of the cost implications.

### Amazon EventBridge: The Event Router

EventBridge is AWS's event bus service, and it's the most recent and most feature-rich of the three. If SNS is a simple broadcaster and SQS is a reliable queue, EventBridge is an intelligent switchboard that routes events based on sophisticated rules.

**The core concept** is that applications send events to an event bus, and rules determine which targets receive which events. An event is a JSON document describing something that happened. Rules use event pattern matching to decide if an event should be sent to a particular target. Rules are flexible and powerful—far more so than SNS subscription filters.

**Event pattern matching** is where EventBridge truly differentiates itself. You define patterns using a JSON format that supports complex conditions. For example, you could write a pattern that matches "all orders from the US with a total exceeding $100" by specifying conditions on nested fields, using comparison operators, and combining multiple conditions with AND/OR logic. This is far richer than SNS's attribute filtering.

EventBridge comes in different variants. The **default event bus** receives events from AWS services themselves—when an EC2 instance changes state, when an S3 object is created, when a Lambda function fails. This is powerful for orchestrating AWS infrastructure. **Custom event buses** are for application-generated events. You can have multiple custom event buses within an account, useful for separating concerns. **SaaS partner event buses** allow third-party SaaS applications to publish events into your AWS environment.

**Latency** is typically sub-second, very good for most use cases, though slightly higher than SNS for pub/sub scenarios since EventBridge performs more complex filtering.

**Cost** is per event published. Similar to SNS, you pay when you publish, and each rule evaluation that results in a target delivery is one event. There's a small per-rule monthly cost as well, which makes EventBridge slightly more expensive than SNS for simple broadcast scenarios but competitive when you need complex routing that would otherwise require application-level logic.

**Targets** are numerous: Lambda, SQS, SNS, Kinesis, Step Functions, HTTP endpoints, and more. Critically, EventBridge can enrich events before delivering them, transform their structure, and even invoke targets conditionally. This flexibility reduces the need for custom application logic.

EventBridge is ideal for **complex event routing**. Imagine a logistics company where shipments generate dozens of events: picked, packed, shipped, out-for-delivery, delivered. Different events trigger different workflows. A "delivered" event should update customer records and trigger a satisfaction survey. A "delivery failed" event should create a support ticket and attempt redelivery. A "package damaged" event should initiate a claim process. EventBridge rules let you specify exactly which events flow to which systems without embedding that logic in the application that generates the events.

Another strength is **integration with AWS services**. EventBridge automatically ingests events from most AWS services. You can easily build workflows where, for example, Lambda function errors automatically trigger SNS notifications, or S3 uploads initiate Step Functions workflows. This native integration is harder or impossible to achieve with SNS or SQS alone.

### Architectural Differences and Trade-offs

**Decoupling and Scalability** differ across the three services. SQS decouples producers from consumers temporally—the producer can publish faster than consumers can process, and the queue acts as a buffer. SNS decouples the producer from *knowing about* consumers, but all subscribers must be ready to receive immediately. EventBridge decouples both temporally and logically—you can add new rules and targets without changing the producer.

**Message Persistence** varies significantly. SQS persists messages until they're consumed and deleted, typically for up to 14 days (configurable). SNS delivers immediately and doesn't persist—if no subscribers are active, the message is lost. EventBridge persists messages briefly in its buffer (a few seconds), which helps with target availability issues, but isn't a long-term queue.

**Ordering guarantees** are important for stateful systems. SQS FIFO queues guarantee strict ordering. SNS and EventBridge provide best-effort ordering in Standard mode but don't guarantee strict delivery order. If your application can tolerate out-of-order processing (many can), SNS and EventBridge's efficiency advantage is significant.

**Throughput characteristics** differ too. SQS can handle millions of messages per second and scales horizontally with consumer count. SNS is similarly high-throughput. EventBridge has high throughput but is slightly more constrained due to the complexity of pattern matching on each event.

**Error handling** is different. SQS has built-in retry and dead-letter queue mechanisms—if a consumer can't process a message, it goes back in the queue or to a DLQ. SNS has retry policies (exponential backoff) for subscriptions. EventBridge has the most sophisticated error handling, with the ability to send unmatched events to a dead-letter queue and retry failed deliveries to targets with configurable policies.

### Filtering Capabilities: Simple vs. Sophisticated

This deserves its own section because it's often the deciding factor.

**SNS filtering** works on message attributes. You publish a message with attributes (key-value pairs), and subscribers define filters that match on those attributes. The format is JSON, and you can match exact values, prefix matches, or use simple lists. For example: `{"store": ["NYC", "LA"]}` matches messages with a store attribute of NYC or LA. It's straightforward and fast, but limited. You can't express complex logical conditions or match on nested values.

**EventBridge filtering** is far more powerful. Patterns are JSON objects that can express complex conditions. You can use comparison operators (`<`, `>`, `<=`, `>=`), ranges, wildcard matching, prefix matching, and exists/not-exists checks. You can combine conditions with AND/OR logic. You can match on nested fields deep in the event structure. For example:

```json
{
  "source": ["myapp"],
  "detail-type": ["order"],
  "detail": {
    "amount": [{ "numeric": [">", 100] }],
    "region": ["us-east-1", "us-west-2"],
    "priority": ["high", "critical"]
  }
}
```

This pattern matches orders from your app with amounts over 100 in specific regions with high or critical priority. Expressing this in SNS would require each subscriber to do filtering in application code.

If your routing logic is simple (all events of a type to all subscribers, or basic attribute matching), SNS is fine and simpler. If routing is complex and you're tempted to add filtering logic in your application code, EventBridge is likely the better choice.

### Cost Comparison in Real Scenarios

Let's work through some concrete numbers to understand cost implications.

**Scenario 1: Batch Job Distribution**

A company processes 10 million jobs per month through a batch system. Each job is independent.

- **SQS Standard**: You'd publish 10 million messages. At SQS pricing (roughly $0.40 per million requests), that's $4/month. Add a bit more for consumer polling, maybe $6/month total. Very cheap.
- **SNS**: 10 million publishes at roughly $0.50 per million = $5/month. Similar cost.
- **EventBridge**: 10 million events at roughly $1 per million = $10/month, plus rule costs. More expensive.

For batch distribution, **SQS wins on cost** because it's the natural fit for the pattern, and you don't need the complex filtering or multiple simultaneous subscribers.

**Scenario 2: Event Fanning Out to Five Services**

An order event needs to notify five downstream services (payment, fulfillment, analytics, marketing, support).

- **SNS**: One publish (1 request) to the topic. Cost = negligible per event. Simplest implementation.
- **SQS with fanout**: Publish once to SNS, but SNS sends to five SQS queues (5 additional SQS messages). So you pay for SNS + 5 SQS messages per event. More expensive but provides durability for each subscriber.
- **EventBridge**: One event published, five rules evaluating it (all matching), five targets invoked. Cost roughly equal to SNS or slightly higher. More flexible if rules get complex.

For straightforward fan-out, **SNS is most cost-effective**. If you need durability (subscribers might be down and you need to retry), combine SNS with SQS queues as subscribers.

**Scenario 3: Complex Event Routing with Many Rules**

A platform has 20 different event types and 50 different routing rules (e.g., "send this event to service A if condition X is true, to service B if condition Y is true"). Conditions are complex.

- **SNS**: You'd need to either create many topics (one per logical group) or do filtering in application code. Operationally complex.
- **EventBridge**: Define 50 rules on a single (or few) event buses. Costs might be higher per event, but operational overhead is much lower. The cost of application complexity and maintenance often outweighs the slight per-event premium.

Here, **EventBridge saves money in the long run** through reduced operational and development overhead.

### Decision Matrix: Scenarios and Recommendations

Let's crystallize guidance with concrete scenarios.

**Use SQS when:**

You're distributing independent jobs to be processed by a fleet of workers (batch processing, transcoding, image resizing). Each job should be processed exactly once by exactly one worker. You want automatic retry if a worker fails, and you can tolerate small delays (seconds to minutes). Your filtering needs are minimal or none. Examples: video transcoding pipelines, report generation jobs, email sending, log processing.

You need strict ordering (SQS FIFO) and exactly-once delivery semantics. Money transfer queues, order processing pipelines where sequence matters.

You want the cheapest option for straightforward point-to-point messaging at high volume.

**Use SNS when:**

One event (like an order being placed or a deployment completing) needs to trigger multiple independent processes. The subscribers are known at design time, and there are fewer than ten of them (it remains manageable). You don't need complex filtering—simple attribute-based filtering is sufficient. Examples: order events triggering payment, fulfillment, analytics; deployment events triggering notifications; security events triggering alarms and logging.

You want to decouple a producer from knowledge of its consumers. A new consumer can subscribe without any changes to the producer. This scalability is SNS's strength.

You need low-latency pub/sub without the complexity of EventBridge.

**Use EventBridge when:**

Event routing is complex with many conditional paths. Different events should flow to different targets based on sophisticated criteria. You're tempted to write complex filtering logic in application code—if so, EventBridge is probably the better home for that logic. Examples: multi-tenant platforms with complex routing per tenant, real-time analytics pipelines with conditional aggregation, infrastructure automation with many conditional workflows.

You want to orchestrate AWS services and third-party SaaS integrations. EventBridge's native integrations and transformation capabilities reduce application code.

You're already using AWS service events and want to extend that pattern to application events. Consistency of approach.

### Real-World Integration Patterns

Understanding how these services work together is crucial.

**SQS + Lambda for asynchronous processing**: Lambda polls an SQS queue, retrieves messages in batches, processes them, and deletes them. This is simple, scalable, and cost-effective. The queue is automatically cleared as Lambda scales up.

**SNS + SQS for durable fan-out**: Publish to an SNS topic, with SQS queues as subscribers. Each queue gets a copy of the message, providing durability. If a consumer is down, messages wait in its queue. This combines SNS's fan-out with SQS's durability. Cost is higher (you pay for both SNS and SQS), but reliability is excellent.

**EventBridge + Step Functions for orchestration**: Events trigger Step Functions executions, which implement complex workflows. EventBridge's rule-based invocation and transformation capabilities work well with Step Functions' orchestration. You can build sophisticated, asynchronous automation.

**EventBridge + Lambda + SQS for advanced processing**: EventBridge rules invoke Lambda functions that perform logic and send results to SQS queues for further processing. This layers the services for maximum flexibility.

### Common Misconceptions

**"SNS is always faster than SQS"**: SNS has lower latency for the publish operation and subscriber notification. SQS introduces consumer polling latency. However, in practice, the overall latency difference is often negligible, and SQS's durability and ordering can be more important.

**"EventBridge is always better because it's newer"**: Newer doesn't mean better for every use case. For simple batch distribution, SQS is simpler and cheaper. For straightforward fan-out, SNS is fine. EventBridge is best when you actually need its filtering and transformation capabilities.

**"I should always use SNS + SQS together"**: This pattern is excellent for durability and fan-out, but it's more expensive and complex than SNS alone. Use it when you need the durability—not as a default.

**"Message ordering only matters for financial transactions"**: Ordering matters when state is cumulative. Customer state updates, inventory changes, and status transitions all benefit from ordering. Think carefully before dismissing it.

### Implementation Considerations

When implementing, pay attention to a few practical details.

**Message size and format**: SQS and SNS have 256 KB limits. For larger payloads, store data in S3 and pass references. EventBridge events are also limited but can be larger with careful design. Use efficient JSON serialization—avoid unnecessary whitespace in production.

**Visibility timeout (SQS)**: This is how long a message is hidden after a consumer reads it but before it's deleted. Too short, and failed consumers will cause duplicates. Too long, and failed jobs hang around. Start with something proportional to your expected processing time (2-3x), and adjust based on monitoring.

**Dead-letter queues**: Absolutely set up DLQs for SQS queues and EventBridge rules. Unprocessable messages shouldn't disappear—they should go somewhere you can inspect and understand what went wrong.

**Monitoring and alarms**: Set CloudWatch alarms on queue depth (SQS), failed deliveries (SNS, EventBridge), and consumer lag. Alert when depth exceeds expected levels—it usually means something's wrong with consumers.

**Idempotency**: Distributed systems sometimes deliver messages twice. Design consumers to be idempotent—applying the same message twice yields the same result as applying it once. This is especially important for SQS Standard and SNS.

### Conclusion

SNS, SQS, and EventBridge are not competing services—they're complementary tools optimized for different patterns. SQS is the reliable, simple queue for point-to-point work distribution. SNS is the lightweight broadcaster for fan-out scenarios. EventBridge is the intelligent event router for complex, conditional logic and AWS service integration.

The best choice depends on your specific needs. Ask yourself: Is this one message for one consumer (SQS)? Is this one event for many independent subscribers (SNS)? Do I need sophisticated routing based on event content (EventBridge)? Often, the right answer is using all three in combination—SNS for the initial broadcast, SQS for durable queuing, EventBridge for complex orchestration.

As you encounter messaging requirements in your own systems, return to these questions. The patterns will become intuitive, and you'll find yourself naturally gravitating toward the right service for each problem.
