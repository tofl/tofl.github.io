---
title: "SNS Message Filtering at Scale: Avoiding Message Explosion"
---

## SNS Message Filtering at Scale: Avoiding Message Explosion

When you first start working with Amazon SNS, the mental model is straightforward: publish a message to a topic, and all subscribers receive it. This simplicity is beautiful, but it becomes a serious problem the moment your event-driven architecture grows beyond a handful of subscribers. Imagine a single SNS topic with hundreds of subscribers, each expecting only a slice of the messages flowing through that topic. Without proper filtering, you're paying to deliver messages that subscribers will immediately discard, wasting bandwidth, money, and goodwill. This article explores how to design SNS architectures that scale elegantly, using topic hierarchies, message filtering policies, and strategic integration patterns to ensure that the right messages reach the right subscribers—and nothing more.

### Understanding the Message Explosion Problem

Before diving into solutions, let's be concrete about what "message explosion" means. Picture an e-commerce platform with a central `order-events` SNS topic. When an order is placed, updated, shipped, or cancelled, a message lands in this topic. Now imagine you have subscribers that care about different event types: one Lambda function processes only shipped orders, another handles refunds, a third sends notifications exclusively for high-value orders, and so on.

Without filtering, every subscriber receives every message. If your topic publishes 10,000 messages per day and you have 50 subscribers, SNS will attempt to deliver 500,000 messages. Most of those messages will be irrelevant to most subscribers. They'll consume SQS queue capacity if subscribers are queues, waste Lambda invocation time if subscribers are Lambda functions, and generate unnecessary CloudWatch logs if subscribers are HTTP endpoints. The cost compounds quickly: SNS charges per million requests, and you're paying for request volume you don't need.

The problem becomes even more acute when you consider operational complexity. Without visibility into what's actually being consumed versus what's being discarded, you lose the ability to understand your system's health and efficiency. Are your subscribers struggling because they're overloaded with irrelevant messages? Or is there a genuine performance issue? Without filtering, you can't tell.

### Why a Single Topic Architecture Breaks Down

The naive solution—create a different SNS topic for every possible event type—sounds appealing but creates its own headaches. If you need to publish an order event, do you post to `order-placed`, `order-updated`, `order-shipped`, and `order-cancelled` separately? Your publisher code becomes fragmented. More problematically, subscribers that care about *all* order events now have to subscribe to multiple topics, complicating their setup and increasing the chance of misconfiguration. You've traded the message explosion problem for a subscriber explosion problem.

The real solution leverages SNS message filter policies, which allow subscribers to declare interest in only the messages they care about based on message attributes. Instead of creating dozens of topics, you publish all related events to a single topic with rich message attributes, and let filter policies do the fine-grained routing.

### Message Attributes and Filter Policies Fundamentals

SNS message filter policies work by examining message attributes—custom key-value pairs you attach to each published message. When a subscriber's filter policy is evaluated against a message's attributes, SNS either delivers the message or silently discards it. No charge is incurred for filtered (discarded) messages.

Let's walk through a practical example. When publishing an order event, you might include attributes like:

```json
{
  "MessageBody": "Order #12345 has been shipped",
  "MessageAttributes": {
    "eventType": {
      "DataType": "String",
      "StringValue": "order-shipped"
    },
    "orderValue": {
      "DataType": "Number",
      "StringValue": "249.99"
    },
    "region": {
      "DataType": "String",
      "StringValue": "us-west-2"
    }
  }
}
```

Now, a Lambda function that processes only high-value shipments in specific regions can subscribe with a filter policy:

```json
{
  "eventType": ["order-shipped"],
  "orderValue": [{"numeric": [">", 100]}],
  "region": ["us-west-2", "us-east-1"]
}
```

This filter policy translates to: "deliver this message only if the event type is exactly 'order-shipped' AND the order value is greater than 100 AND the region is either us-west-2 or us-east-1." SNS evaluates the policy on every message, and only matching messages are delivered to this subscriber. The others are discarded at the SNS service layer, without being sent to the subscriber and without incurring delivery charges.

Filter policies support several matching operators beyond simple equality. You can use numeric comparisons (`<`, `>`, `<=`, `>=`), prefix matching, wildcard patterns, and even complex nested logic with `anything-but` for exclusions. This flexibility allows you to express nearly any subscription intent without creating a new topic.

### Designing a Multi-Tier Topic Hierarchy

While filter policies solve fine-grained routing, they work best when combined with coarse-grained topic categorization. Rather than a single `order-events` topic for your entire platform, consider a hierarchy like:

- `platform/orders` — all order-related events
- `platform/payments` — all payment-related events
- `platform/fulfillment` — all fulfillment-related events
- `platform/users` — all user-related events

This separation serves multiple purposes. First, it reduces the volume of messages any single topic receives, which improves SNS throughput characteristics. Second, it provides a natural boundary for access control—a service that manages fulfillment doesn't need to publish to user events and shouldn't have permission to do so. Third, it makes the intent of each topic clearer to developers joining the team.

Within each topic, you then layer filter policies. A fulfillment notification service might subscribe to `platform/orders` with a filter policy for order-shipped events, while a fraud detection service might subscribe to `platform/payments` with a filter policy for high-value transactions. This two-layer approach—coarse-grained topic hierarchy combined with fine-grained filter policies—scales remarkably well.

The key is striking the right balance. If you create too many topics, you replicate the subscriber explosion problem. If you create too few, filter policies become complex and processing becomes inefficient. A good heuristic is to create topics around business domains or major event categories (orders, payments, users, etc.), then use filter policies within each domain for specific event types or business logic.

### Cost Impact and the Math of Filtering

One of the most compelling reasons to implement filter policies is the direct cost reduction. SNS pricing is straightforward: you pay per million requests. A request is either a publish or a delivery attempt. If you publish 10,000 messages to a topic with 50 subscribers, that's 10,000 publishes plus 500,000 delivery attempts—for a total of 510,000 requests. If an effective filter policy causes 80% of those deliveries to be discarded at the SNS service layer, you've reduced delivery attempts to 100,000, cutting your delivery cost by 80%.

To illustrate with concrete numbers: at the time of writing, SNS pricing is approximately $0.50 per million requests. That difference between 500,000 and 100,000 delivery attempts costs you $0.20 versus $0.04 per day—not huge at this scale, but scale it to millions of messages across hundreds of subscribers, and the math becomes impressive. A platform publishing 1 million messages per day to 200 subscribers without filtering pays roughly $100 per day in delivery costs. With 80% filter efficiency, that drops to $20 per day. Over a year, that's an $29,200 difference.

Beyond the direct cost savings, there's the secondary effect: by not delivering irrelevant messages to subscribers, you reduce the load on your subscriber systems. Lambda functions are invoked fewer times, reducing compute costs. SQS queues receive fewer messages, potentially allowing you to scale down consumer instances. HTTP endpoints receive fewer requests, reducing bandwidth and processing overhead. In large systems, these secondary savings often exceed the SNS delivery cost savings.

### Implementing and Monitoring Filter Policy Efficiency

Creating a filter policy is straightforward, but ensuring it's actually effective requires visibility. The first step is to implement filter policies consistently. When your team publishes to SNS, they should always include relevant message attributes. When subscribing, they should always define filter policies rather than accepting everything and filtering downstream.

To monitor filter policy efficiency, enable SNS delivery status logging. When you configure SNS to log delivery outcomes to CloudWatch, you can track how many messages were delivered versus discarded for each subscriber. Create a CloudWatch Insights query to analyze this:

```
fields @timestamp, @message
| filter eventType = "Publish"
| stats count() as total_publishes by subscriptionArn
| sort total_publishes desc
```

And a companion query for delivery success rates:

```
fields @timestamp, @message, @logStream
| filter @message like /Publish|Deliver/
| stats count() as attempts by subscriptionArn, @logStream
```

These queries help you identify subscriptions with unusually high discard rates, which might indicate misconfigured filter policies or publisher bugs. They also serve as validation that your filtering strategy is working as intended.

Another useful monitoring approach is to create a custom metric that tracks the proportion of messages delivered versus published for each topic. If a topic publishes 10,000 messages daily but only delivers 2,000 to all subscribers combined, you know that filtering is aggressive—which might be correct, or might indicate a problem. Regular review of these metrics ensures your architecture remains aligned with your intent.

### Combining SNS with EventBridge for Complex Routing

As your event-driven system grows more sophisticated, you may find that message attributes and SNS filter policies alone aren't expressive enough. Imagine a scenario where you need to route messages based on nested JSON structures within the message body, or based on temporal conditions (e.g., "deliver this message only during business hours"), or based on external state (e.g., "consult a DynamoDB table to determine routing"). SNS filter policies can't handle these scenarios.

This is where Amazon EventBridge comes in. EventBridge is a serverless event router that accepts events from various sources—including SNS topics—and routes them based on sophisticated rules. You can publish your events to an SNS topic, subscribe an EventBridge rule to that topic, and then define a rule with matching logic far more powerful than SNS filter policies alone.

For example, you might have a rule that matches orders exceeding a certain value threshold during specific hours, then sends them to an SQS queue for high-priority processing:

```json
{
  "Name": "HighValueOrderProcessing",
  "EventPattern": {
    "source": ["sns"],
    "detail-type": ["order-event"],
    "detail": {
      "eventType": ["order-placed"],
      "orderValue": [{"numeric": [">", 1000]}],
      "timestamp": [{"exists": true}]
    }
  },
  "State": "ENABLED",
  "Targets": [
    {
      "Arn": "arn:aws:sqs:us-east-1:123456789012:high-priority-queue",
      "RoleArn": "arn:aws:iam::123456789012:role/EventBridgeRole"
    }
  ]
}
```

The beauty of this approach is that SNS handles the initial fan-out to all interested consumers (keeping that operation simple and fast), and EventBridge handles sophisticated content-based routing for subscribers that need it. You get the simplicity of publish-subscribe with the power of complex event processing.

### Architectural Patterns for Enterprise Scale

As you scale to enterprise proportions, several architectural patterns emerge as particularly effective. The first is the **domain-driven topic hierarchy** we discussed earlier, but expanded. Instead of a flat list of topics, organize them by business domain:

```
platform/
  ├── orders/
  │   ├── order-events
  │   └── order-fulfillment
  ├── payments/
  │   ├── payment-events
  │   └── payment-reconciliation
  └── users/
      └── user-events
```

This structure makes it clear what each topic contains and who owns it. A team can be responsible for an entire domain, knowing that other teams' changes won't unexpectedly affect their subscriptions.

The second pattern is **fanout with filtering at the edge**. Rather than publishing a single event to a central topic with hundreds of subscribers, you publish to a domain topic with a smaller set of initial subscribers. Those initial subscribers are Lambda functions or microservices that perform domain-specific transformation and then publish refined events to more specialized downstream topics. This is known as a multi-hop or multi-tier fan-out pattern. It distributes the routing logic across the system, making each hop simpler and easier to understand.

The third pattern is **dead-letter topic aggregation**. When an SNS delivery fails (subscriber endpoint is down, permission issues, etc.), SNS can route those failures to a dead-letter SNS topic for later analysis. By aggregating failures from multiple topics into a single dead-letter topic with appropriate filtering, you gain unified visibility into system health.

The fourth pattern combines **SNS with SQS for durable consumption**. Instead of subscribing Lambda functions or HTTP endpoints directly to SNS, subscribe SQS queues. SQS provides durability, allowing messages to be retried if processing fails. Each consumer then reads from its own SQS queue at its own pace. This decoupling is powerful: if a consumer is temporarily slow, it builds up a queue backlog without affecting other subscribers. If a consumer crashes, messages are safe in SQS. When combined with filter policies on the SNS-to-SQS subscription, you ensure that each SQS queue receives only the messages relevant to its consumer.

### Avoiding Common Pitfalls

Even with the best intentions, teams often stumble on SNS filtering at scale. One common mistake is forgetting to define filter policies on subscriptions, thinking "we'll filter downstream." This defeats the entire purpose—you're paying for and processing messages you don't need. Make filter policies mandatory in your organizational standards.

Another pitfall is creating filter policies that are too specific, filtering away legitimate messages due to edge cases. For example, a filter policy that expects an `orderValue` attribute might discard messages from free-tier orders that legitimately have no orderValue. Always include a catch-all or carefully consider missing attributes in your policies. SNS treats a missing attribute as a non-match by default, which can be surprising.

A third mistake is ignoring filter policy complexity as the system grows. As you add more subscribers and more attributes, policies can become intricate. Periodically audit your filter policies for redundancy or conflicting logic. If you notice that certain combinations of policies keep appearing, that's a signal to create a new topic for that subset of events.

Finally, don't neglect monitoring. It's easy to set up filter policies and assume they're working correctly forever. Drift happens: publishers start including different attributes, business logic changes, subscribers are added or removed. Regular review of metrics and logs keeps your filtering strategy aligned with reality.

### Conclusion

Designing SNS architectures that scale requires moving beyond the single-topic-single-subscriber mental model. By combining a thoughtful topic hierarchy with expressive message filter policies, you can route events efficiently to hundreds or thousands of subscribers without the overhead of separate topics for each combination. The cost savings are real, the operational complexity is reduced, and your system becomes more maintainable and resilient.

The key principles are simple: organize topics around business domains, publish rich message attributes, define explicit filter policies on every subscription, and monitor your filtering efficiency. When SNS filter policies alone aren't sufficient, reach for EventBridge to handle sophisticated routing logic. As your system grows, refine your architecture based on observed patterns and real operational data rather than premature optimization.

Building event-driven systems at scale is challenging, but with these patterns and practices in place, you can build systems that are both cost-effective and a pleasure to operate.
