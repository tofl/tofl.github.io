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

{{< qcm >}}
[
{
"question": "A developer is building an e-commerce platform on AWS. When an order is placed, the application needs to simultaneously trigger an email confirmation, update inventory, and start a fulfillment workflow. Which AWS service is best suited to fan out this event to all three consumers with the least operational overhead?",
"answers": [
{
"answer": "Amazon EventBridge with a custom event bus and three rules",
"isCorrect": true,
"explanation": "EventBridge allows a single event emitted by a producer to be routed to multiple targets via independent rules. Each consumer subscribes to events it cares about without knowing the others exist, which is the ideal pattern for decoupled fan-out."
},
{
"answer": "AWS Lambda invoking each downstream service sequentially",
"isCorrect": false,
"explanation": "Chaining Lambda calls creates tight coupling and brittle pipelines. If one step fails, it can block the rest. This is exactly the architecture EventBridge was designed to replace."
},
{
"answer": "Amazon SQS with a single queue shared by all consumers",
"isCorrect": false,
"explanation": "A single SQS queue delivers each message to only one consumer. It does not natively support fan-out to multiple independent services."
},
{
"answer": "Amazon SNS with a topic and three SQS subscriptions",
"isCorrect": false,
"explanation": "SNS can fan out, but it lacks the rich content-based filtering, schema registry, and event bus model of EventBridge. For complex event-driven architectures with pattern matching, EventBridge is the preferred choice."
}
]
},
{
"question": "Which of the following are valid types of event buses in Amazon EventBridge? (Select THREE)",
"answers": [
{
"answer": "Default bus",
"isCorrect": true,
"explanation": "The default bus exists automatically in every AWS account and receives events from AWS services such as EC2, S3, and CodePipeline."
},
{
"answer": "Custom bus",
"isCorrect": true,
"explanation": "Custom buses are created by users to carry application-specific events, enabling decoupled communication between internal services."
},
{
"answer": "Partner bus",
"isCorrect": true,
"explanation": "Partner buses receive events from supported third-party SaaS providers such as Datadog, Shopify, and GitHub, flowing directly into your AWS account."
},
{
"answer": "Regional bus",
"isCorrect": false,
"explanation": "There is no 'Regional bus' type in EventBridge. Cross-region routing is handled by targeting an event bus in another region from a rule, not through a dedicated bus type."
},
{
"answer": "Global bus",
"isCorrect": false,
"explanation": "'Global bus' is not a concept in EventBridge. EventBridge buses are account- and region-scoped."
}
]
},
{
"question": "A rule on an Amazon EventBridge custom bus is configured to route events to an AWS Lambda function. The Lambda function is occasionally throttled during peak load, causing delivery failures. What should the developer configure to ensure failed events are not permanently lost?",
"answers": [
{
"answer": "Attach an SQS queue as a Dead-Letter Queue (DLQ) on the rule target",
"isCorrect": true,
"explanation": "When EventBridge exhausts its retry policy for a target, failed events are dropped unless a DLQ is configured. Attaching an SQS DLQ captures these events for later inspection or reprocessing."
},
{
"answer": "Increase the Lambda function's concurrency limit only",
"isCorrect": false,
"explanation": "Increasing concurrency reduces throttling but does not protect against events lost if throttling still occurs. A DLQ is still required as a safety net."
},
{
"answer": "Enable schema discovery on the bus",
"isCorrect": false,
"explanation": "Schema discovery captures the structure of events for code generation purposes. It has no effect on delivery reliability or failure handling."
},
{
"answer": "Switch from a custom bus to the default bus",
"isCorrect": false,
"explanation": "The type of event bus does not affect delivery retry behavior or failure handling. DLQ configuration is set at the rule target level, regardless of bus type."
}
]
},
{
"question": "An EventBridge rule is configured with a retry policy. What are the maximum values supported for retry attempts and maximum event age? (Select TWO)",
"answers": [
{
"answer": "Up to 185 retry attempts",
"isCorrect": true,
"explanation": "EventBridge supports configuring up to 185 retry attempts per target, with exponential backoff between each attempt."
},
{
"answer": "Up to 24 hours maximum event age",
"isCorrect": true,
"explanation": "The maximum event age can be set to up to 24 hours. EventBridge will stop retrying once the event exceeds this age, even if retry attempts remain."
},
{
"answer": "Up to 72 hours maximum event age",
"isCorrect": false,
"explanation": "The maximum event age is capped at 24 hours, not 72. Events older than the configured maximum age are discarded (or sent to a DLQ if configured)."
},
{
"answer": "Up to 10 retry attempts",
"isCorrect": false,
"explanation": "EventBridge supports far more than 10 retries — up to 185. This is a significantly higher limit than many developers might assume."
}
]
},
{
"question": "A developer wants to invoke a Lambda function every weekday at 9:00 AM UTC using Amazon EventBridge. Which rule configuration achieves this?",
"answers": [
{
"answer": "A scheduled rule with cron expression cron(0 9 ? * MON-FRI *)",
"isCorrect": true,
"explanation": "EventBridge cron expressions follow the format cron(minutes hours day-of-month month day-of-week year). This expression fires at minute 0, hour 9, every Monday through Friday."
},
{
"answer": "A scheduled rule with rate(9 hours)",
"isCorrect": false,
"explanation": "rate(9 hours) fires every 9 hours from the time the rule is enabled, not at a specific time of day, and not limited to weekdays."
},
{
"answer": "An event pattern rule matching detail-type: DailyTrigger",
"isCorrect": false,
"explanation": "Event pattern rules react to incoming events. No AWS service emits a 'DailyTrigger' event type. A scheduled rule is the correct mechanism."
},
{
"answer": "A scheduled rule with cron(9 0 * * MON-FRI)",
"isCorrect": false,
"explanation": "This uses an incorrect cron format. EventBridge cron syntax requires six fields: minutes, hours, day-of-month, month, day-of-week, and year."
}
]
},
{
"question": "What is the maximum number of targets a single Amazon EventBridge rule can deliver events to simultaneously?",
"answers": [
{
"answer": "5",
"isCorrect": true,
"explanation": "A single EventBridge rule supports up to five targets. If fan-out to more targets is needed, additional rules must be created."
},
{
"answer": "1",
"isCorrect": false,
"explanation": "A rule can deliver to more than one target simultaneously — up to five. This fan-out capability is a key feature of EventBridge."
},
{
"answer": "10",
"isCorrect": false,
"explanation": "The limit is five targets per rule, not ten."
},
{
"answer": "Unlimited",
"isCorrect": false,
"explanation": "There is a hard limit of five targets per rule. For more targets, you can create additional rules on the same bus or use SNS as an intermediary target."
}
]
},
{
"question": "A developer needs to filter Amazon EventBridge events so that only EC2 instance terminations in the us-east-1 region trigger a Lambda function. Which EventBridge feature enables this?",
"answers": [
{
"answer": "Event pattern matching on the rule",
"isCorrect": true,
"explanation": "EventBridge rules support content-based filtering using JSON patterns that can match on source, detail-type, region, account, or any field inside the detail object — including specific values like instance state and region."
},
{
"answer": "Input transformation on the target",
"isCorrect": false,
"explanation": "Input transformation reshapes the event payload before delivery. It does not filter which events trigger the rule — that is the role of event pattern matching."
},
{
"answer": "Schema discovery",
"isCorrect": false,
"explanation": "Schema discovery catalogs the structure of events for developer tooling. It does not filter or route events."
},
{
"answer": "EventBridge Pipes",
"isCorrect": false,
"explanation": "Pipes support filtering, but they are designed for one-to-one source-to-target integrations from streaming/queue sources. For filtering events from AWS services on the default bus, a rule with an event pattern is the standard approach."
}
]
},
{
"question": "A developer is integrating an EventBridge custom bus with a Lambda function. The Lambda function only needs three specific fields from the full EventBridge event envelope. How can the developer avoid writing parsing logic in the Lambda code?",
"answers": [
{
"answer": "Configure an input transformer on the rule target to extract and reshape the payload before delivery",
"isCorrect": true,
"explanation": "Input transformers allow EventBridge to extract specific fields, rename keys, and inject static values before delivering the event to a target. The Lambda function receives exactly the payload it expects, with no manual parsing needed."
},
{
"answer": "Enable schema discovery and download code bindings",
"isCorrect": false,
"explanation": "Schema discovery and code bindings help developers understand event structure at development time. They do not change the payload delivered to the Lambda function at runtime."
},
{
"answer": "Use a Dead-Letter Queue to capture and reformat events",
"isCorrect": false,
"explanation": "A DLQ captures failed delivery events. It is not a mechanism for transforming payloads before delivery."
},
{
"answer": "Switch to a partner event bus",
"isCorrect": false,
"explanation": "Partner buses receive events from SaaS providers. Changing bus type does not affect payload transformation."
}
]
},
{
"question": "Which of the following statements correctly describes the difference between EventBridge Pipes and EventBridge Rules?",
"answers": [
{
"answer": "Rules can fan out to multiple targets simultaneously; Pipes connect a single source to a single target with optional enrichment in between",
"isCorrect": true,
"explanation": "Rules are designed for fan-out: one event matched by a rule can be delivered to up to five targets. Pipes are point-to-point: one source, optional filtering and enrichment, one target — without writing custom glue code."
},
{
"answer": "Pipes support multiple targets; Rules are limited to one target",
"isCorrect": false,
"explanation": "This is the reverse of the truth. Rules support up to five targets; Pipes are strictly one-to-one."
},
{
"answer": "Pipes replace Rules for all EventBridge use cases",
"isCorrect": false,
"explanation": "Pipes and Rules serve different purposes and coexist. Pipes are suited for enriched one-to-one integrations; Rules are suited for event-driven fan-out patterns."
},
{
"answer": "Rules support enrichment steps; Pipes do not",
"isCorrect": false,
"explanation": "It is Pipes that support an optional enrichment step (via Lambda, Step Functions, or API Gateway). Rules deliver events to targets directly, without a built-in enrichment stage."
}
]
},
{
"question": "A company wants to collect CloudTrail events from all AWS accounts in their organization into a single security account for centralized analysis. Which EventBridge capability supports this architecture?",
"answers": [
{
"answer": "Cross-account event routing by targeting an event bus in the security account from rules in each source account",
"isCorrect": true,
"explanation": "EventBridge supports cross-account routing: a rule in a source account can target an event bus in a different account. The receiving bus must have a resource-based policy granting the source account permission to send events. This enables centralized aggregation architectures."
},
{
"answer": "Partner bus integration with a SaaS SIEM provider",
"isCorrect": false,
"explanation": "Partner buses receive events from supported SaaS providers. They are not used for routing events between AWS accounts within an organization."
},
{
"answer": "Schema discovery with cross-account sharing enabled",
"isCorrect": false,
"explanation": "Schema discovery captures event structures for developer tooling. It does not route events between accounts."
},
{
"answer": "EventBridge Scheduler with a cross-account IAM role",
"isCorrect": false,
"explanation": "EventBridge Scheduler is for time-based invocations, not for routing events produced by other AWS services across accounts."
}
]
},
{
"question": "A developer needs to send per-user renewal reminders to millions of subscribers, each at a different scheduled datetime. Which AWS service is best suited for this use case?",
"answers": [
{
"answer": "EventBridge Scheduler",
"isCorrect": true,
"explanation": "EventBridge Scheduler is designed for creating millions of individual scheduled invocations, each with its own target time. It supports one-time schedules, timezone-aware scheduling, and flexible time windows — ideal for per-user reminders at scale."
},
{
"answer": "An EventBridge rule with a cron expression",
"isCorrect": false,
"explanation": "A cron-based rule fires all targets at the same time on the same schedule. It cannot represent millions of individual per-user schedules."
},
{
"answer": "Amazon CloudWatch Alarms",
"isCorrect": false,
"explanation": "CloudWatch Alarms trigger based on metric thresholds, not on specific datetimes. They are not suited for scheduling per-user events."
},
{
"answer": "AWS Step Functions with a Wait state",
"isCorrect": false,
"explanation": "Step Functions Wait states can pause until a specific time, but managing millions of concurrent executions purely for scheduling creates significant operational overhead compared to EventBridge Scheduler."
}
]
},
{
"question": "Which of the following are supported sources for EventBridge Pipes? (Select TWO)",
"answers": [
{
"answer": "Amazon SQS",
"isCorrect": true,
"explanation": "SQS is a supported source for EventBridge Pipes. Events are polled from the queue and passed through the pipe to the target."
},
{
"answer": "Amazon DynamoDB Streams",
"isCorrect": true,
"explanation": "DynamoDB Streams is a supported Pipes source, allowing change data capture records to be filtered, enriched, and forwarded to a target without custom polling code."
},
{
"answer": "Amazon S3 event notifications",
"isCorrect": false,
"explanation": "S3 event notifications are not a native source for EventBridge Pipes. S3 events can be sent to EventBridge via S3 Event Notifications configured to use EventBridge, but they are then handled by rules, not Pipes."
},
{
"answer": "AWS CloudFormation stacks",
"isCorrect": false,
"explanation": "CloudFormation is not a supported Pipes source. CloudFormation events can appear on the default EventBridge bus and be matched by rules."
}
]
},
{
"question": "A developer enables schema discovery on a custom EventBridge bus. What benefit does this provide?",
"answers": [
{
"answer": "EventBridge automatically infers the structure of events and stores schemas, which developers can use to download typed code bindings for their IDE",
"isCorrect": true,
"explanation": "Schema discovery detects and registers the JSON structure of events flowing through a bus. Developers can download code bindings in Java, Python, or TypeScript, giving them typed objects and removing guesswork when writing producers and consumers."
},
{
"answer": "EventBridge automatically validates all incoming events and rejects those that do not match the schema",
"isCorrect": false,
"explanation": "Schema discovery is passive — it catalogs structures but does not enforce or validate incoming events against those schemas."
},
{
"answer": "EventBridge automatically creates rules for every discovered schema",
"isCorrect": false,
"explanation": "Schema discovery stores schemas in the registry but does not create rules. Rules must be created manually by the developer."
},
{
"answer": "EventBridge encrypts events whose schema has been registered",
"isCorrect": false,
"explanation": "Schema registration has no effect on event encryption. Encryption at rest and in transit is handled separately and is not schema-dependent."
}
]
},
{
"question": "How does Amazon EventBridge relate to Amazon CloudWatch Events?",
"answers": [
{
"answer": "EventBridge is the evolution of CloudWatch Events, sharing the same underlying API, with custom buses, partner integrations, schema registry, Pipes, and Scheduler added on top",
"isCorrect": true,
"explanation": "EventBridge was built on top of CloudWatch Events. Existing CloudWatch Event rules continue to function on the default EventBridge bus, and all concepts map directly. For exam purposes they are treated as the same service."
},
{
"answer": "EventBridge replaces CloudWatch Events completely and existing CloudWatch Event rules must be migrated manually",
"isCorrect": false,
"explanation": "No manual migration is required. Existing CloudWatch Event rules continue to work on the default EventBridge bus without modification."
},
{
"answer": "CloudWatch Events is newer than EventBridge and offers more features",
"isCorrect": false,
"explanation": "CloudWatch Events is the predecessor. EventBridge is the newer, more capable evolution of the service."
},
{
"answer": "They are entirely separate services with no shared API or infrastructure",
"isCorrect": false,
"explanation": "EventBridge and CloudWatch Events share the same underlying API. EventBridge is an extension, not a separate implementation."
}
]
},
{
"question": "A team adds a new fraud detection service that must react to the same OrderPlaced events already consumed by three other services. What change is required to the existing architecture to integrate the new service?",
"answers": [
{
"answer": "Add a new EventBridge rule on the custom bus that targets the fraud detection service; no changes are needed to the order service or existing rules",
"isCorrect": true,
"explanation": "This is the core value of EventBridge's decoupled model. Producers and existing consumers are completely unaware of each other. Adding a new consumer requires only a new rule — zero changes to the order service or any existing rule."
},
{
"answer": "Update the order service to emit a second event specifically for the fraud detection service",
"isCorrect": false,
"explanation": "This reintroduces coupling. The producer should not need to know about its consumers. EventBridge rules handle routing transparently."
},
{
"answer": "Modify each existing rule to also forward events to the fraud detection service",
"isCorrect": false,
"explanation": "Existing rules do not need to change. A new independent rule is the correct and minimal way to add a consumer in an EventBridge architecture."
},
{
"answer": "Create a new custom bus for the fraud detection service and replicate events to it",
"isCorrect": false,
"explanation": "A new bus is unnecessary here. All services can subscribe via rules on the same custom bus. Creating a second bus adds complexity without benefit."
}
]
},
{
"question": "An EventBridge Scheduler schedule is configured with a flexible time window of 15 minutes. What does this mean?",
"answers": [
{
"answer": "The invocation will occur within a 15-minute window around the target time, allowing AWS to spread load and avoid traffic spikes",
"isCorrect": true,
"explanation": "Flexible time windows instruct EventBridge Scheduler to invoke the target at any point within the defined window around the scheduled time. This smooths out load when many schedules fire near the same time."
},
{
"answer": "The schedule will retry for up to 15 minutes if the target fails",
"isCorrect": false,
"explanation": "Flexible time windows control when an invocation is triggered, not how long retries continue. Retry behavior is configured separately."
},
{
"answer": "The schedule will be delayed by exactly 15 minutes from the configured time",
"isCorrect": false,
"explanation": "A flexible window means the invocation happens anywhere within the window — it is not a fixed delay of the full window duration."
},
{
"answer": "The schedule will run every 15 minutes",
"isCorrect": false,
"explanation": "This describes a rate-based recurring schedule, not a flexible time window. A flexible window modifies when a single scheduled invocation fires, not its frequency."
}
]
},
{
"question": "A developer wants to receive events from a Shopify store directly in their AWS account. Which EventBridge feature enables this integration?",
"answers": [
{
"answer": "A partner event bus configured for the Shopify integration",
"isCorrect": true,
"explanation": "EventBridge partner buses allow events from supported SaaS providers — including Shopify — to flow directly into your AWS account. You enable the partner integration and events arrive on the partner bus without custom polling or webhooks."
},
{
"answer": "A custom event bus with an event pattern rule matching source: shopify",
"isCorrect": false,
"explanation": "Custom buses carry your own application events. To receive events from an external SaaS partner, you must use a partner bus, not a custom bus."
},
{
"answer": "An EventBridge Pipe with Shopify as a source",
"isCorrect": false,
"explanation": "Pipes connect AWS sources (SQS, Kinesis, DynamoDB Streams) to targets. SaaS provider integration uses partner buses, not Pipes."
},
{
"answer": "Schema discovery with a Shopify schema imported manually",
"isCorrect": false,
"explanation": "Schema discovery registers event structures for tooling purposes. It does not establish a connection to receive events from a SaaS provider."
}
]
},
{
"question": "Which of the following EventBridge event pattern matching capabilities are supported? (Select THREE)",
"answers": [
{
"answer": "Prefix matching on string fields",
"isCorrect": true,
"explanation": "EventBridge event patterns support prefix matching, allowing rules to match events where a string field starts with a specified value."
},
{
"answer": "Numeric range matching",
"isCorrect": true,
"explanation": "Numeric ranges are supported in event patterns, enabling rules such as 'match events where the amount field is greater than 100'."
},
{
"answer": "anything-but negation matching",
"isCorrect": true,
"explanation": "EventBridge patterns support anything-but conditions, which match when a field does NOT equal the specified value — useful for excluding specific event types or sources."
},
{
"answer": "Full-text search across the entire event body",
"isCorrect": false,
"explanation": "EventBridge pattern matching operates on the JSON structure of the event. It does not support unstructured full-text search across the entire event payload."
}
]
}
]
{{< /qcm >}}