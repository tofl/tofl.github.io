---
title: "EventBridge Pipes vs Rules vs Step Functions: When to Use Each"
---

## EventBridge Pipes vs Rules vs Step Functions: When to Use Each

If you've spent time working with AWS event-driven architectures, you've probably encountered a moment of hesitation when deciding between EventBridge Rules, EventBridge Pipes, and Step Functions. All three can move data between services, all three respond to events, and all three can trigger workflows. Yet they're fundamentally different tools designed for different problems. Understanding when to reach for each one is crucial for building scalable, maintainable systems on AWS—and it's a topic that trips up many developers preparing for advanced certifications.

The good news: the confusion is understandable, because these services genuinely overlap in capability. The better news: once you understand the core design philosophy behind each, the decision becomes logical and straightforward.

In this article, we'll dissect the strengths and constraints of each service, explore real-world scenarios where one clearly outshines the others, and walk through a practical decision framework you can apply to your own architectures.

### Understanding EventBridge Rules: The Fan-Out Model

Let's start with EventBridge Rules, since they're the most foundational building block of event-driven architectures on AWS.

An EventBridge Rule is fundamentally a pattern matcher paired with one or more targets. You define a rule using JSON pattern matching against events flowing through an event bus (either the default bus or a custom bus you've created). When an event matches your rule's pattern, EventBridge forwards that event to every target you've specified for that rule.

The key characteristic here is the **one-to-many, or fan-out model**. A single rule can send the same event to multiple targets simultaneously. If you have an order placed event and you want to trigger inventory updates, send a confirmation email, record an analytics event, and notify a fulfillment service, a single rule can fan that event out to all four targets in parallel.

Here's what a rule pattern matching looks like in practice. Imagine you receive events from an e-commerce application that look like this:

```json
{
  "source": "myapp.orders",
  "detail-type": "Order Placed",
  "detail": {
    "orderId": "12345",
    "customerId": "cust-789",
    "totalAmount": 99.99,
    "region": "us-west-2"
  }
}
```

You could create a rule to match only high-value orders:

```json
{
  "source": ["myapp.orders"],
  "detail-type": ["Order Placed"],
  "detail": {
    "totalAmount": [{"numeric": [">", 50]}]
  }
}
```

When this rule matches, EventBridge sends the event to all configured targets. You might attach targets like an SQS queue for order processing, an SNS topic for notifications, and a Lambda function for risk assessment—all triggered by the same event, all in parallel.

The beauty of Rules is their simplicity and parallelism. The limitation is equally important to understand: EventBridge Rules provide minimal data transformation. You can use input transformers to reshape the event into a different JSON structure before sending it to targets, but that's largely the extent of it. There's no built-in filtering at the target level, no enrichment from external data sources, and no conditional routing based on enrichment results.

Rules also don't provide retry logic beyond what individual targets support. If a target fails, EventBridge has a dead-letter queue mechanism, but orchestrating complex retry logic across multiple targets becomes your responsibility.

### Introducing EventBridge Pipes: The Focused Pipeline Model

EventBridge Pipes represent a different philosophy entirely. Rather than broadcasting events to multiple destinations, Pipes implement a focused, linear pipeline: source → filter → enrich → target.

A Pipe connects a single event source to a single target. The sources supported by Pipes are specific: SQS queues, Kinesis streams, DynamoDB Streams, Managed Streaming for Apache Kafka (MSK) topics, and self-managed Apache Kafka clusters. Notice that these are all sources that produce events asynchronously and often require polling or stream processing.

The Pipe then applies three optional transformation stages:

**Filtering** happens first. You define a JSON pattern (similar to EventBridge Rule patterns) that determines which messages from your source are processed. Messages that don't match are silently dropped.

**Enrichment** comes next. This is where Pipes shine compared to Rules. An enrichment step allows you to query an external service—a Lambda function, an API Gateway endpoint, a DynamoDB table, or a CodeBuild project—to fetch additional data. That enriched data is then merged into the event before it reaches the target.

Imagine a Pipe reading messages from an SQS queue containing order IDs. Before sending the order to a downstream service, you could enrich it by invoking a Lambda function that fetches the full order details from a database, or queries a pricing service to calculate final costs.

**Transformation** is the final stage (sometimes called "output transformation"), where you reshape the event into whatever format your target expects.

Here's a conceptual example of a Pipe in action:

```
SQS Queue (source)
  ↓
Filter: Only orders with totalAmount > 50
  ↓
Enrich: Invoke Lambda to fetch customer details and add to event
  ↓
Transform: Reshape into format expected by target system
  ↓
SNS Topic (target)
```

The critical thing to understand about Pipes is that they're **point-to-point**. One Pipe connects one source to one target. If you need to send that enriched data to multiple destinations, you'd create multiple Pipes, each with its own enrichment logic. This is very different from Rules' fan-out model.

Pipes are excellent for stream-based processing where you need filtering and enrichment before forwarding data downstream. They're less ideal when you need one event to trigger multiple independent actions, because you'd need separate Pipes for each target.

### Step Functions: Orchestration and Long-Running Workflows

Step Functions operate at a completely different level of abstraction. While Rules and Pipes handle event routing and transformation, Step Functions coordinate multi-step workflows that may involve human approval, long wait times, complex branching logic, and interactions across many AWS services.

A Step Function is a state machine. You define your workflow as a series of states connected by transitions. States can execute Lambda functions, invoke other AWS services, wait for specified durations, make decisions based on data, run parallel branches, catch and handle errors, and much more.

A key distinction: Step Functions workflows are often **long-running**. They might process for seconds, minutes, hours, or even days. A single execution maintains state throughout, and you can query the execution at any time to see its current status and progress.

Consider a document processing workflow:

1. Receive document upload event
2. Extract text using Textract
3. Analyze sentiment with Comprehend
4. If sentiment is negative, route to human review via SQS and wait for approval
5. If approved or positive sentiment, send to downstream archive
6. Log completion

This workflow spans multiple services, includes human intervention, and has conditional branching. Step Functions is the natural fit for this pattern. Rules or Pipes would struggle to elegantly handle the waiting for human approval or the complex conditional logic.

Step Functions also provide first-class error handling. You can define catch blocks for specific error types, implement retry policies with exponential backoff, and set maximum retry counts—all declaratively in your workflow definition.

### Side-by-Side Comparison

To cement these differences, let's look at how each service handles a few common requirements:

**Multiple Targets**: EventBridge Rules excel here. One rule, multiple targets, all triggered in parallel. EventBridge Pipes require separate Pipes for each target (with duplicate enrichment logic). Step Functions can orchestrate calls to multiple services, but they're orchestrating sequentially (or in parallel branches you explicitly define) rather than fanning out automatically.

**Filtering and Enrichment**: EventBridge Pipes are purpose-built for this. Rules offer basic filtering but minimal enrichment. Step Functions can implement any filtering or enrichment logic via Lambda functions, but it's not the core design pattern.

**Long-Running Workflows with State**: Step Functions is the only practical choice. Rules and Pipes are ephemeral—they process an event and move on. Step Functions maintains state across the entire execution lifecycle.

**Stream Processing**: Pipes are designed specifically for Kinesis, DynamoDB Streams, SQS, and Kafka. They integrate natively with the polling and batching patterns these sources use. Rules operate on events already published to an event bus. Step Functions could invoke stream consumers, but they're not optimized for this pattern.

**Conditional Logic and Branching**: Step Functions provide the richest experience. Rules have basic pattern matching. Pipes have basic filtering. Step Functions let you branch, loop, and make complex decisions throughout the workflow.

**Error Handling and Retries**: Rules offer dead-letter queues. Pipes support basic error handling. Step Functions provide granular, declarative retry and catch policies.

### Real-World Scenarios

Let's walk through several concrete scenarios and determine which service fits best.

**Scenario 1: Multi-Channel Notifications on User Signup**

When a user signs up for your application, you need to:
- Add them to a welcome email campaign
- Create a record in a data warehouse
- Trigger an SMS verification message
- Log the event to a compliance audit trail

This is a classic fan-out scenario. A single signup event needs to trigger four independent actions in parallel. **EventBridge Rules** are the perfect fit. Create one rule matching signup events, attach four targets (SQS queue for email service, Kinesis stream for data warehouse, SNS topic for SMS, and CloudWatch Logs for audit), and you're done. All four execute in parallel.

**Scenario 2: Processing Orders from a Kafka Cluster with Enrichment**

Your e-commerce platform produces order events to a Kafka cluster. Before those orders reach your fulfillment system, you need to:
- Filter out test orders
- Enrich each order with current inventory levels from DynamoDB
- Reshape the payload to match your legacy fulfillment system's API

This is a stream-processing scenario with stateful enrichment. **EventBridge Pipes** shine here. Configure a Pipe with your Kafka cluster as the source, add a filter to exclude test orders, enrich via a Lambda that queries DynamoDB, transform to the legacy format, and send to your fulfillment service via HTTPS endpoint. The Pipe handles polling your Kafka cluster and batching, while you focus on the business logic of filtering and enrichment.

**Scenario 3: Complex Document Approval Workflow**

Your organization needs to process expense reports:
1. Receive report submission
2. Extract data using Textract
3. Check policy compliance with Lambda
4. If non-compliant, create a task in a work queue for manual review (and wait for approval)
5. If compliant, route directly to accounting system
6. Send notification email to submitter with final status
7. Archive the report to S3

This involves waiting for human intervention, conditional routing, multi-step processing, and state management across time. **Step Functions** is the right tool. Define a state machine with a task state for Textract, a decision state to check compliance, a wait state that polls for human approval, and Lambda invocations for notifications and archiving. The Step Function orchestrates the entire flow, maintains state, handles errors gracefully, and you can query progress at any time.

**Scenario 4: Scheduled Data Pipeline with Multiple Transformations**

Every night at 2 AM, you want to pull metrics from CloudWatch, transform them, enrich them with business context from an API, and write results to three different destinations (S3, DynamoDB, and Redshift). The entire process should take under 5 minutes.

Here, the right choice depends on your perspective. If you think of this as "one source triggering three parallel targets," you might use **EventBridge Rules** triggered by a scheduled rule. But if you think of it as "pull from CloudWatch, enrich with business context, distribute to three destinations," **Step Functions** provides better control over the sequence and error handling. You'd create a Step Function that retrieves metrics, enriches them, and then fans out to three parallel task branches writing to each destination. The slight added complexity of Step Functions pays for itself in clearer error handling and monitoring.

### Decision Framework

To help crystallize your thinking, here's a practical decision tree:

Start by asking: **What is my primary use case?**

If your answer is "I have one event that needs to trigger many independent actions," choose **EventBridge Rules**. Rules are optimized for fan-out parallelism.

If your answer is "I need to pull from a stream source (SQS, Kinesis, DynamoDB Streams, or Kafka), filter, enrich, and forward to a single target," choose **EventBridge Pipes**. Pipes excel at point-to-point stream processing with transformation.

If your answer is "I need to orchestrate a multi-step workflow with conditional logic, human approval, waiting, or complex error handling," choose **Step Functions**. Step Functions are built for stateful orchestration.

If you're still uncertain, consider these secondary factors:

**Latency matters?** Rules and Pipes are low-latency, processing events in milliseconds. Step Functions add overhead and are measured in seconds at minimum (especially if waiting is involved). For real-time event processing, Rules and Pipes are superior.

**I need to enrich from an external source?** Pipes have enrichment built in. Rules can't natively enrich without invoking a Lambda target. Step Functions can enrich via Lambda tasks. But if enrichment is central to your use case, Pipes are the most elegant solution.

**I need to handle human workflows?** Only Step Functions support true waiting for human approval. Rules and Pipes would require you to build approval loops yourself.

**I need rich error handling and retries?** Step Functions provide the most comprehensive error handling. Rules and Pipes offer basic mechanisms, but Step Functions let you define retry policies, catch blocks, and fallback states declaratively.

**One source, multiple targets?** Rules win. One rule can fan to many targets. Pipes require separate pipes per target (though you could feed them all to the same intermediate target like SNS or SQS, which then distributes further).

### Practical Implementation Example

Let's tie this together with a realistic multi-service architecture. Imagine a retail platform where:

1. Orders are placed through an API and published to EventBridge
2. Orders in high-value categories need special handling
3. Order details need to be enriched from a DynamoDB inventory table
4. Orders should fan out to multiple fulfillment centers based on region
5. Complex approval workflows exist for orders exceeding $10,000

Here's how you'd layer these services:

**Layer 1: EventBridge Rules for Fan-Out**

Create a rule matching all order events. Attach targets for basic processing: an SQS queue for inventory synchronization, a CloudWatch Logs destination for auditing, and an SNS topic for ops notifications. These are independent, parallel actions.

**Layer 2: EventBridge Pipes for Enrichment**

For orders that need inventory enrichment before fulfillment, create a Pipe. Source from an SQS queue (populated by the Rule above), filter for items requiring enrichment, enrich via Lambda querying DynamoDB, transform into fulfillment center format, and target SQS queues for regional fulfillment centers. Separate Pipes for each region if their transformation needs differ.

**Layer 3: Step Functions for Approval Workflows**

High-value orders (> $10,000) trigger a Step Function workflow. The workflow calls Lambda to validate the order against policy, creates a task in your approval queue (via SNS or SQS), waits for human decision (polling or using task tokens), and then either routes to fulfillment or rejection. This workflow maintains state, handles approval timeouts, and provides clear audit trails.

This layered approach gives you the parallelism of Rules, the enrichment elegance of Pipes, and the orchestration power of Step Functions, each doing what it does best.

### Common Pitfalls to Avoid

**Overusing Step Functions for simple fan-out scenarios.** Developers sometimes reach for Step Functions' orchestration power to handle what is fundamentally a one-to-many problem. If your workflow is "event comes in, trigger these independent actions," Rules are simpler and cheaper.

**Underusing Pipes' enrichment capabilities.** Teams often build enrichment logic into Lambda targets attached to Rules, when a dedicated Pipe with enrichment would be cleaner and more maintainable.

**Mixing stream processing patterns incorrectly.** If you're polling SQS or Kinesis continuously and processing records, Pipes are built for this pattern. Using Rules to trigger Lambda polling loops is less efficient than letting Pipes handle the polling natively.

**Creating duplicate Pipes when a single Rule with multiple targets would suffice.** If you have the same source event triggering multiple independent actions with similar or no transformation, Rules are more economical than multiple Pipes.

**Expecting Rules to handle complex transformations.** Input transformers on Rules are powerful but not meant for complex logic. Complex transformations belong in Pipe transformation stages or Step Function Lambda tasks.

### Conclusion

EventBridge Rules, EventBridge Pipes, and Step Functions each occupy a distinct ecological niche in AWS's event-driven architecture ecosystem. Rules broadcast events to multiple targets in parallel—think fan-out notifications. Pipes create focused, linear pipelines with filtering and enrichment—think stream processing with transformation. Step Functions orchestrate multi-step workflows with state, waiting, and complex logic—think long-running business processes.

The key to choosing correctly is understanding your primary requirement: Do you need parallelism (Rules), point-to-point enrichment (Pipes), or stateful orchestration (Step Functions)? Once you answer that, the choice becomes natural.

In practice, sophisticated event-driven architectures often use all three. Rules might fan out to multiple initial targets, Pipes might enrich specific streams, and Step Functions might orchestrate the complex approval workflows. Understanding when each service excels allows you to build systems that are not only functional but elegant—where each piece serves its intended purpose without unnecessary complexity.

Start by identifying the core pattern your use case requires, then layer in the other services where they genuinely add value. Your future self (and your operations team) will appreciate the clarity that comes from making these distinctions explicit in your architecture.
