---
title: "EventBridge vs SNS vs SQS: Choosing the Right Messaging Service on AWS"
---

## EventBridge vs SNS vs SQS: Choosing the Right Messaging Service on AWS

When you're building distributed systems on AWS, you'll eventually face a moment of decision: which messaging service should I use? At first glance, EventBridge, SNS, and SQS might seem interchangeable—they all move data from point A to point B. But each has been carefully designed with different problems in mind, different architectures in mind, and different trade-offs baked into its DNA.

Understanding the nuances between these three services isn't just academic. Pick the wrong one, and you'll find yourself fighting against the service's design instead of with it. You might end up with filtering logic scattered across multiple Lambda functions when the service could have handled it natively. Or you might struggle with ordering guarantees when another service would have given them to you automatically. Or you might simply overpay for capabilities you never needed.

This article cuts through the confusion by examining how each service works, where they excel, and—crucially—where they fall short. By the end, you'll have a clear mental model for making this decision in your own projects.

### Understanding the Core Purpose of Each Service

Before we compare, let's establish what each service fundamentally does.

**SQS** is the oldest of the three and serves as a durable message queue. Think of it as a reliable mailbox where producers drop messages and consumers pick them up. The key word is *durable*—messages persist in SQS until a consumer explicitly deletes them, even if the consumer crashes immediately after receiving the message. SQS guarantees at-least-once delivery, meaning a message might be processed multiple times if something goes wrong, but it won't be silently lost.

**SNS** is a publish-subscribe service. Many producers can publish messages to a single topic, and many consumers can subscribe to that topic. When a message arrives, SNS immediately pushes it to all subscribers simultaneously. This is fan-out—one message triggers parallel processing across multiple systems. SNS is optimized for speed and scale; messages aren't persisted for long and are deleted once delivered to all subscribers (or if no subscribers exist).

**EventBridge** is the newest and most sophisticated. It's a managed event bus that acts as a router and filter for events. Producers send events to the bus, which evaluates them against rules you've defined, and then routes matching events to the appropriate targets. The clever part is the filtering—EventBridge can examine the content of an event and decide which targets should receive it without you writing custom logic.

The distinction matters because they solve different problems. If you need durable storage and guaranteed eventual processing of work, think SQS. If you need to broadcast a message to many subscribers at once, think SNS. If you need intelligent routing with content-based filtering, think EventBridge.

### SQS: The Reliable Worker Queue

SQS shines when you have work that must be processed, possibly later, by a single consumer type. Imagine you're processing image uploads. A user uploads a photo, and you drop a message into an SQS queue with the object key and metadata. A fleet of Lambda functions or EC2 instances reads from the queue, processes each image, and deletes the message when done. If processing fails partway through, the message stays in the queue and will be retried.

One of SQS's defining characteristics is the visibility timeout. When a consumer receives a message, it becomes invisible to other consumers for a configurable period (default 30 seconds). If the consumer crashes without deleting the message, the message reappears in the queue after the timeout expires, and another consumer can try again. This mechanism prevents messages from being lost due to unexpected failures.

SQS comes in two flavors: standard and FIFO. Standard queues offer maximum throughput but provide only best-effort ordering. FIFO queues guarantee that messages are processed in the exact order they were sent, which is crucial for operations like financial transactions or maintaining state-dependent workflows. The trade-off is that FIFO queues have lower throughput limits.

Retention is configurable, ranging from one minute to fourteen days. Messages that aren't deleted within the retention period are automatically purged. This makes SQS suitable for handling work that might accumulate during traffic spikes—you can scale your consumers up to process the backlog without worrying about messages disappearing.

Cost-wise, SQS charges per million requests, making it economical for high-volume workloads. You pay for every receive request, so batching helps reduce costs.

The downside? SQS has no built-in filtering. If you send different types of events to the same queue, your consumer must handle all types and filter internally. There's also no native fan-out; one queue can have many consumers, but they compete for messages rather than each receiving a copy. If you need multiple systems to process the same event independently, you'd typically couple SQS with SNS (more on that pattern later).

### SNS: The Fast Fan-Out Broadcast

SNS excels when you have one event that needs to trigger multiple independent actions across different systems. Consider a new user registration event. You want to send a welcome email, log the signup in an analytics system, provision a trial account, and update a data warehouse—all independently and in parallel. SNS is perfect for this because you publish once and all subscribers receive the message simultaneously.

SNS uses a push model, shoving messages to subscribers immediately. This makes it fast—subscribers don't need to poll or wait for messages. The service handles the fan-out automatically, which is elegant and reduces coupling between systems. Each subscriber can implement its own logic without knowledge of the others.

SNS topics can have many types of subscribers: Lambda functions, SQS queues, HTTP endpoints, email addresses, SMS numbers, and even mobile applications. This flexibility means you can add a new consumer without modifying the producer; just add a new subscription.

However, SNS doesn't persist messages. Once delivered to all subscribers (or immediately if no subscribers exist), the message is gone. This makes SNS unsuitable if you need guaranteed processing by a system that might be temporarily unavailable. If a Lambda function subscribed to an SNS topic is misconfigured and can't handle messages, those messages simply disappear—you get no second chance.

Ordering is not guaranteed. If message order is critical, SNS isn't your answer. Messages also can't be filtered by content on the SNS side; filtering happens in the subscriber. This means if you have an SNS topic with many message types, each subscriber receives everything and must discard what it doesn't care about.

Cost-wise, SNS charges per million published messages, making it economical when you have few publishers but many subscribers.

### EventBridge: The Intelligent Event Router

EventBridge represents a higher level of abstraction. Instead of thinking about publishers and subscribers, you think about events and rules. You send events to an event bus, define rules that match events using JSON pattern matching, and specify targets for matching events. The bus handles the routing.

The real power lies in the pattern matching. You can write rules that inspect event content and route based on specific fields. For example, you might route all orders over $100 to a fraud detection system while routing smaller orders directly to fulfillment. You never hardcode this logic in your application; the event bus handles it.

EventBridge supports over 90 AWS services as targets, plus HTTP endpoints and third-party integrations. This breadth is remarkable. You can route events to Lambda, EC2, SNS topics, SQS queues, Kinesis streams, Step Functions state machines, ECS tasks, and many others. When AWS releases a new service, it often gains EventBridge support automatically.

There's also the ability to archive and replay events. If you discover a bug in your event-processing logic, you can replay archived events through corrected logic without regenerating the source events. This is invaluable for debugging and recovery.

EventBridge has a schema registry feature that lets you document and discover event structures, supporting development workflows where teams share event formats. This governance becomes valuable at scale.

The filtering model is far richer than SNS. You can match on event source, event detail type, and nested fields within the event. You can use equality, prefix matching, numeric comparisons, and complex logical conditions. This eliminates the need to push filtering logic into your consumers.

Event ordering is configurable. By default, EventBridge offers best-effort ordering, but you can use event sources with guaranteed ordering or route events through SQS or Kinesis for strict sequencing.

However, EventBridge isn't a queue—it doesn't inherently persist messages for retry. If a target fails, EventBridge will retry based on your dead-letter queue configuration, but the semantics are different from SQS's explicit message acknowledgment. There's no visibility timeout or consumer group concept. And while cost is generally reasonable, it's more complex to calculate than SNS or SQS.

### Trade-offs and Key Differences

Let's examine the most important dimensions where these services diverge.

**Ordering Guarantees:** SQS FIFO provides strict message ordering. EventBridge offers best-effort ordering by default but can be configured for stronger guarantees through specific event sources. SNS provides no ordering guarantees—subscribers might receive messages in any order. If ordering matters to your use case, SQS FIFO is your only simple answer; the others require careful architecture.

**Content-Based Filtering:** EventBridge has rich, declarative filtering built in. SNS and SQS require your application to filter. This matters for operational simplicity and reducing data movement costs—why send data to a Lambda function that just discards it? EventBridge lets you filter at the bus.

**Throughput and Latency:** SNS and SQS both handle extremely high throughput (millions of messages per second), and latency is typically sub-second. EventBridge is similarly fast but has softer throughput guarantees due to the sophistication of pattern matching. For most production workloads, this distinction is academic, but if you're processing billions of messages daily, it's worth benchmarking.

**Persistence and Retry:** SQS is explicitly designed for durability and retry. Messages stay until explicitly deleted. SNS is fire-and-forget; messages are pushed immediately and don't survive subscriber failures. EventBridge sits in the middle—it will retry failed targets based on your policy, but the retry logic is less flexible than SQS's consumer-driven model.

**Target Flexibility:** SQS and SNS have been around longer and integrate with more AWS services through time-tested patterns. EventBridge targets over 90 services natively. SNS targets are more limited by design. If you need to route to an obscure AWS service, EventBridge is your best bet.

**Cost Model:** SQS charges per request (favorable for high-volume, long-running workloads). SNS charges per message published (favorable for many subscribers per message). EventBridge charges per rule evaluation (favorable for complex filtering scenarios with many rules). For low-volume, simple use cases, all three are essentially free.

### Decision Matrix and Selection Criteria

To crystallize the decision, consider this framework:

**Choose SQS if:**
- You need reliable, durable queuing with guaranteed processing.
- Ordering is critical (use FIFO).
- You have a clear producer-consumer relationship, not complex fan-out.
- You want consumers to control their own pace (pull-based processing).
- You're building an internal job queue or task processing system.
- You need visibility timeout semantics and explicit message deletion.

**Choose SNS if:**
- One event needs to trigger multiple independent processes.
- Subscribers need to receive messages immediately (push model).
- You have a clear one-to-many relationship.
- Subscribers are heterogeneous (email, SMS, Lambda, HTTP, etc.).
- You don't need content-based filtering.
- You can afford to lose messages if no subscribers are configured.

**Choose EventBridge if:**
- You need sophisticated content-based routing and filtering.
- You're building an event-driven architecture with many event types.
- You want a single place to define routing rules declaratively.
- You need to route to AWS services and third-party APIs flexibly.
- You want event archiving and replay capabilities.
- Your rules might change frequently and you want to avoid redeploying code.

### Real-World Scenarios

Let's ground this in concrete examples.

**Scenario One: E-Commerce Order Processing**

A user places an order on your e-commerce platform. You need to charge their payment card, reserve inventory, send a confirmation email, update analytics, and trigger a fulfillment workflow.

This is a textbook SNS scenario. The order-placed event is published to an SNS topic with multiple subscribers: a Lambda function for payment processing, another for inventory reservation, another for email, and another for analytics. All happen in parallel. Each subscriber processes independently and can handle failures on its own timeline.

However, if you need to conditionally route based on order characteristics—for example, high-value orders go to a fraud detection system while others go directly to fulfillment—then EventBridge becomes attractive. You'd define a rule that checks order amount and routes accordingly, eliminating the need to hardcode this logic in your application.

**Scenario Two: Image Resizing Pipeline**

Users upload images to your S3 bucket, and you need to generate thumbnails, apply filters, and update a database. Processing might take seconds or minutes.

This is a classic SQS scenario. S3 triggers are configured to send a message to an SQS queue when a new object is created. A fleet of workers polls the queue, processes each image, and deletes the message when done. If a worker crashes mid-processing, the message reappears in the queue for retry. You can scale workers up during traffic spikes and down during quiet periods, with work safely accumulating in the queue.

Could you use SNS instead? Technically yes, but it's awkward because if a Lambda subscriber crashes while processing, you lose the message. You'd likely wrap SNS with SQS as a dead-letter queue, which adds complexity. SQS alone is simpler.

**Scenario Three: Event-Driven Analytics Platform**

Your platform collects events from various sources: website clicks, API calls, service metrics, user actions. Different teams need different subsets of these events. The data science team needs all events, the fraud team needs login and payment events, the marketing team needs purchase events.

This is EventBridge's domain. Events flow into a central event bus. You define rules that route events based on their type and attributes. The data science team's rule captures everything. The fraud team's rule matches on specific event types. The marketing team's rule looks for purchase events. New teams can be onboarded by adding new rules without changing producers. You can even archive all events to S3 for long-term analysis using a rule that matches everything.

### Combining Services for Complex Scenarios

Often, the right answer isn't one service in isolation but a thoughtful combination.

**SNS-to-SQS Fan-Out and Scale:** Publish a message to SNS, which has multiple SQS queues as subscribers. This gives you the best of both worlds: SNS's fan-out capability and SQS's durability and consumer-controlled processing. It's common when you have many independent consumer services that might process at different rates. The SNS topic is the fan-out point, and each service has its own SQS queue, insulating it from the others' failures and pace.

**EventBridge to SQS for Complex Routing with Durable Processing:** Route events through EventBridge rules to SQS queues based on content. This provides intelligent routing with the durability guarantees of a queue. It's particularly useful when you have many event types and want to route them to different processing pipelines.

**EventBridge to SNS for Selective Fan-Out:** Use EventBridge rules to filter events and route matching ones to SNS topics. This is helpful when you want some filtering before fan-out. For instance, only high-priority events get broadcast to all subscribers; others go to a single queue.

These combinations show that the services aren't in competition—they're complementary tools in your distributed systems toolkit.

### Performance, Reliability, and Cost Considerations

**Performance:** SNS and SQS both achieve millisecond latencies at scale. EventBridge adds the overhead of rule evaluation, but in practice, latency is still sub-second for most use cases. If you're building a real-time system with strict latency requirements (sub-100ms), SNS or SQS are safer choices. Kinesis might actually be better for that scenario, but that's another story.

**Reliability:** All three services are highly available, with messages replicated across multiple availability zones. SQS offers the strongest durability guarantees due to its queue semantics. SNS and EventBridge are reliable but don't persist messages indefinitely, so they're less suitable for critical work you can't afford to lose.

**Cost:** For a typical workload with moderate message volume, differences are negligible. SQS's per-request pricing is favorable for high-volume batch processing. SNS's per-message pricing is favorable for high fan-out ratios. EventBridge's rule-evaluation pricing is favorable for complex filtering scenarios. Run the numbers for your expected volume, but don't let cost alone drive the decision—operational simplicity matters more.

### Common Pitfalls and Mistakes

Developers often make predictable mistakes when choosing between these services. Here are the most common:

Using SNS when you need durability is a sneaky trap. SNS seems simpler because it's just "publish and done." But if the subscriber is unavailable, the message vanishes. Wrapping SNS with SQS or using EventBridge's dead-letter queue mitigates this, but it's extra complexity you could have avoided by choosing SQS upfront.

Ignoring filtering requirements is another frequent error. Teams start with SQS or SNS, then realize they need to filter messages. They add filtering logic to every consumer, spreading the logic across the codebase. Six months later, when requirements change, updating the filtering is a nightmare. EventBridge's declarative filtering would have saved countless hours.

Underestimating the complexity of strict ordering is a third mistake. Teams choose SNS or SQS standard for speed or simplicity, then discover mid-project that ordering matters. Migrating to SQS FIFO or re-architecting around EventBridge with specific event sources becomes a late-stage refactor.

Overthinking the decision is equally problematic. Not every system needs EventBridge's sophistication. Sometimes a simple SQS queue is exactly right, and adding EventBridge just adds operational overhead and cost.

### Practical Guidance for Architects and Teams

When facing this decision, follow this thought process:

Start by asking: Is this fan-out or point-to-point? If many independent systems need to react to the same event, you're looking at SNS or EventBridge. If work flows from producer to consumer, SQS is your baseline.

Next: Do I need durable, guaranteed processing? If yes, SQS is mandatory (or EventBridge with dead-letter queues, but that's more complex). If you can afford occasional message loss, SNS works.

Then: Do I need content-based filtering? If yes, EventBridge. If no, evaluate SNS or SQS based on the fan-out question.

Finally: What are the throughput, latency, and ordering requirements? These rarely drive the decision outright but inform fine-tuning (e.g., FIFO vs. standard, batching strategies).

For teams adopting event-driven architecture at scale, EventBridge often emerges as the center of the system, with SQS queues as buffers at the edges and SNS topics for specific fan-out scenarios. But for smaller teams or simpler systems, SQS alone might be sufficient. Don't reach for sophistication you don't need.

### Conclusion

EventBridge, SNS, and SQS each excel in their domain. SQS is the reliable worker queue, best for durability and consumer-controlled processing. SNS is the fast broadcast service, best for fan-out to independent subscribers. EventBridge is the intelligent router, best for complex event-driven architectures with rich filtering and routing requirements.

The right choice isn't determined by which service is newest or most feature-rich, but by your specific architectural needs. Ask yourself whether you need durability, fan-out, or sophisticated filtering, and the decision becomes clear.

As you design systems, remember that these services often work together. The patterns that combine them—SNS-to-SQS, EventBridge-to-SQS—are battle-tested approaches that add resilience without undue complexity. Start simple, and add sophistication only as requirements demand it.

The payoff for making the right choice is enormous: systems that are easier to reason about, more reliable, cheaper to operate, and simpler to evolve as requirements inevitably change. That's worth the thoughtful consideration this decision deserves.
