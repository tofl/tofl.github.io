---
title: "14. EventBridge"
type: docs
weight: 4
---

## EventBridge

Amazon EventBridge is a serverless event bus that connects AWS services, your own applications, and third-party SaaS platforms by routing events from producers to consumers based on rules you define. It exists to solve a fundamental integration problem: how do you let dozens of services react to things that happen in your system without coupling them together? Before EventBridge, you'd wire services directly — Lambda calls SQS, SQS triggers Lambda, Lambda calls another Lambda — creating brittle chains that are hard to change and harder to debug. EventBridge inverts this: producers emit events onto a bus, and any number of consumers subscribe to exactly the events they care about. Neither side knows about the other.

EventBridge is a major DVA-C02 focus because it is the backbone of modern event-driven architecture on AWS. Understanding how it routes events, filters them, and handles failures is essential.

### Event Buses

Every event in EventBridge lands on an **event bus** [🔗](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-event-bus.html). There are three kinds:

- **Default bus** — automatically exists in every AWS account and receives events from AWS services (EC2 state changes, S3 object creation, CodePipeline state changes, etc.). You cannot delete it.
- **Custom buses** — buses you create for your own application events. Your order service emits `order.placed`, your inventory service listens. Neither service talks to the other directly.
- **Partner buses** — receive events from supported SaaS providers (Datadog, Shopify, Zendesk, GitHub, etc.) [🔗](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-saas.html). You enable a partner integration and their events flow straight into your account.

The bus itself does nothing to events — it just receives them. Rules decide what happens next.

### Rules: Pattern Matching and Scheduling

A **rule** [🔗](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rules.html) sits on a bus and watches every event that arrives. It does one of two things:

- **Event pattern matching** — inspects the event's JSON structure and forwards it to a target only when it matches. Patterns can match on source, detail-type, account, region, or any field inside the `detail` object, including prefix matching, numeric ranges, and `anything-but` negation. A rule like "forward all EC2 instance terminations in us-east-1" is a single JSON pattern.
- **Scheduled invocation** — triggers a target on a cron expression or rate (e.g., `rate(5 minutes)`, `cron(0 8 * * ? *)`). This is what replaced CloudWatch Scheduled Events. No incoming event is needed; EventBridge generates the trigger itself.

A single rule can fan out to up to five targets simultaneously.

### Targets

When a rule matches, EventBridge delivers the event (or a transformed version of it) to one or more **targets** [🔗](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-targets.html). The supported target list is broad and includes Lambda functions, SQS queues, SNS topics, Step Functions state machines, API Gateway endpoints, ECS tasks, Kinesis Data Streams, and more.

**Input transformation** is worth understanding well. Before delivering to a target, EventBridge can reshape the event — extracting only the fields the target needs, renaming keys, or injecting static values — using an input transformer [🔗](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-transform-target-input.html). This means your Lambda function doesn't have to parse a raw EventBridge envelope; it receives exactly the payload it expects.

### Schema Registry and Schema Discovery

EventBridge can automatically discover the structure of events flowing through your buses and store them in the **Schema Registry** [🔗](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-schema.html). Once a schema is registered, you can download code bindings (Java, Python, TypeScript) that give you typed objects for those events in your IDE. This removes guesswork when writing producers and consumers — you know exactly what fields an event contains and their types.

Schema discovery is enabled per bus. For production workloads it reduces integration bugs significantly, and for the exam it's worth knowing it exists and what problem it solves.

### EventBridge Pipes

**EventBridge Pipes** [🔗](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-pipes.html) provide a point-to-point integration between a single source and a single target, with optional filtering and enrichment in between. Think of a Pipe as a managed pipeline: events flow from a source (SQS, Kinesis, DynamoDB Streams, Kafka) → optional filter → optional enrichment step (Lambda, Step Functions, API Gateway) → target.

The key distinction from rules: Pipes are for one-to-one integrations where you want to enrich or transform events in transit, without writing glue code. A rule fans out to multiple targets; a Pipe enriches on the way to one target.

### EventBridge Scheduler

**EventBridge Scheduler** [🔗](https://docs.aws.amazon.com/scheduler/latest/UserGuide/what-is-scheduler.html) is a separate but related service for running scheduled tasks at scale. Unlike a rule-based schedule, Scheduler supports:

- **One-time schedules** — invoke a target once at a specific datetime.
- **Recurring schedules** — cron or rate expressions, identical to rule-based schedules.
- **Flexible time windows** — allow invocations to be spread across a window (e.g., within 15 minutes of the target time) to smooth out load spikes.
- **Timezone-aware scheduling** — no UTC offset math required.

Use Scheduler when you need millions of individual schedules (per-user reminders, subscription renewals) rather than a single recurring rule.

### Dead-Letter Queues and Retry Policies

When EventBridge successfully matches a rule but fails to deliver to a target (the target returns an error, or is throttled), it applies a **retry policy** [🔗](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-rule-dlq.html). You configure the maximum number of retry attempts (up to 185) and the maximum event age (up to 24 hours). EventBridge retries with exponential backoff.

If delivery still fails after exhausting retries, the event is dropped — unless you've configured a **Dead-Letter Queue**. Attaching an SQS queue as a DLQ for a rule target means failed events land there for inspection, alerting, or reprocessing. This is the same DLQ pattern you'll see across SQS, SNS, and Lambda — EventBridge follows the same model.

### Cross-Account and Cross-Region Event Routing

EventBridge supports routing events across AWS accounts and regions [🔗](https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-cross-account.html). A rule on a source bus can target an event bus in a different account or region. The receiving bus requires a resource-based policy that permits the source account to send events. This enables centralized event processing architectures — for example, a security account that aggregates CloudTrail events from every account in an organization.

### EventBridge vs CloudWatch Events

CloudWatch Events was the predecessor service. EventBridge is its evolution — same underlying API, but with custom buses, partner integrations, schema registry, Pipes, and Scheduler added on top. The `aws.events` source and all existing CloudWatch Event rules continue to work on the default EventBridge bus. For the exam, treat them as the same service; if a question refers to "CloudWatch Events," the concepts map directly to EventBridge rules on the default bus.

### Practical Example: Decoupled Order Processing

An e-commerce application emits a custom event `{"source": "myapp.orders", "detail-type": "OrderPlaced", "detail": {"orderId": "123", "amount": 99.99}}` onto a custom bus whenever a purchase completes. Three independent rules listen on that bus:

1. A rule targeting a Lambda function that sends a confirmation email.
2. A rule targeting an SQS queue consumed by the inventory service.
3. A rule targeting Step Functions to start a fulfillment workflow.

None of these consumers knows the others exist. Adding a fourth — a fraud detection service — means adding one rule, with zero changes to any existing service or to the order service itself. This is the core value of EventBridge: loose coupling at the architecture level.