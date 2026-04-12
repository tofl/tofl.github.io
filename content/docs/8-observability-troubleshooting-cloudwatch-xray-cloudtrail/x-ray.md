---
title: "26. X-Ray"
type: docs
weight: 2
---

## X-Ray

Modern applications rarely live in a single process. A user request might pass through an API Gateway, trigger a Lambda function, query DynamoDB, call an external HTTP service, and publish to an SQS queue — all before a response is returned. When something goes wrong (or is simply slow), finding *where* in that chain the problem originated is genuinely hard with logs alone. AWS X-Ray solves this by tracing requests end-to-end across your distributed system, giving you a visual map of every service involved and exactly how long each hop took. For the DVA-C02 exam, X-Ray is the go-to answer whenever a question involves diagnosing latency, pinpointing errors in a microservice architecture, or understanding request flow.

### Distributed Tracing Concepts

X-Ray organizes telemetry around a few core primitives [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-concepts.html):

- **Trace** — A single end-to-end request journey. Every trace gets a unique `X-Amzn-Trace-Id` header that is propagated across service boundaries so X-Ray can stitch the full picture together.
- **Segment** — One service's contribution to a trace. Each instrumented service (e.g., your Lambda function, your EC2 application) emits a segment that records timing, HTTP metadata, errors, and the service identity.
- **Subsegment** — A finer-grained unit *within* a segment. Use subsegments to time individual downstream calls: a DynamoDB `GetItem`, an outbound HTTP request, or a block of custom application logic. Subsegments are how you get granular visibility inside a single service.

When you look at a trace in the X-Ray console, you see a **timeline view** (a Gantt-style breakdown of every segment and subsegment) that immediately reveals where time was spent and where errors occurred.

### The X-Ray Daemon and SDK Instrumentation

X-Ray data does not go directly to the X-Ray API from your application. Instead, your code uses the **X-Ray SDK** to generate trace data, which is buffered and sent over UDP to a locally running **X-Ray daemon** process. The daemon batches and forwards the data to the X-Ray service. This decouples your application from network latency to the X-Ray API.

- On **EC2**, you install and run the daemon yourself [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-daemon.html).
- On **Elastic Beanstalk**, you enable it with a single configuration option [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-beanstalk.html).
- On **Lambda** and **ECS**, AWS manages the daemon for you — you just enable X-Ray tracing in the service configuration.

**SDK instrumentation** is what makes your application emit segments in the first place. The SDK is available for Node.js, Python, Java, Go, Ruby, and .NET [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-instrumenting-your-app.html). At a minimum, you wrap your incoming request handler and patch the AWS SDK and HTTP clients so that downstream calls are automatically captured as subsegments. For example, in a Node.js Lambda function, you replace `require('aws-sdk')` with `AWSXRay.captureAWS(require('aws-sdk'))` — from that point on, every DynamoDB or S3 call is automatically traced.

### Annotations vs. Metadata

Both are ways to attach custom data to a segment or subsegment, but they serve different purposes and have different behaviors:

- **Annotations** are key-value pairs (string, number, or boolean) that are **indexed** by X-Ray. Because they're indexed, you can use them to **filter and search traces** in the console or API. Use annotations for data you'll want to query — things like `customerId`, `orderStatus`, or `environment`.
- **Metadata** are arbitrary objects (any JSON-serializable value) that are **not indexed**. They're recorded in the trace for debugging purposes but cannot be used in filter expressions. Use metadata for rich diagnostic data — a full request payload, a config snapshot — that you want to inspect on a specific trace but don't need to search across.

A simple rule of thumb: if you want to find *all traces where X is true*, use an annotation. If you just want context when you're already looking at a trace, use metadata.

### The Service Map

The **Service Map** [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-console-servicemap.html) is one of X-Ray's most valuable outputs — a dynamically generated graph of every service involved in your traced requests, with edges showing the call relationships between them. Each node displays:

- Request rate (requests per minute)
- Error and fault rates (4xx vs 5xx)
- Average response time

This makes it immediately obvious which service in a chain is the bottleneck or the source of errors, without needing to correlate log files manually. In an exam scenario, if you're asked how to *visualize* dependencies between microservices and identify the root cause of latency, the service map is the answer.

### Sampling Rules

In a high-traffic production system, tracing every single request would be expensive and unnecessary. X-Ray uses **sampling** to record a statistically representative subset of requests while keeping costs manageable [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-console-sampling.html).

The default rule records the **first request per second** plus **5% of additional requests**. You can define custom sampling rules with conditions based on service name, HTTP method, URL path, and host — for example, tracing 100% of requests to `/checkout` while sampling only 1% of requests to `/healthcheck`. Rules are evaluated in priority order, and the first match wins.

Sampling rules are configured centrally in the X-Ray console and pulled by the daemon/SDK at runtime, so you can adjust sampling behavior without redeploying your application.

### X-Ray Integrations

X-Ray integrates natively with several AWS services, meaning trace context is automatically propagated without manual header management [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-services.html):

- **AWS Lambda** — Enable active tracing in the function configuration. Lambda automatically creates a segment for each invocation; you add subsegments for downstream calls via the SDK. [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-lambda.html)
- **API Gateway** — Enable X-Ray tracing on a stage. API Gateway creates a segment for each request and passes the trace header to your backend. [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-services-apigateway.html)
- **ECS** — Run the X-Ray daemon as a sidecar container in the same task. Your application container sends segments to `localhost:2000` (UDP). [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-daemon-ecs.html)
- **EC2** — Install the daemon as a background process; instrument your application with the SDK.
- **Elastic Beanstalk** — Enable via the `.ebextensions` config or the Beanstalk console; the daemon is managed for you.

### Groups and Filter Expressions

**Filter expressions** [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-console-filters.html) let you query traces in the console using a simple syntax — for example, `responsetime > 2` to find slow traces, or `annotation.customerId = "abc-123"` to find all traces for a specific customer (leveraging an annotation you've set). You can also filter by `fault` (5xx errors), `error` (4xx errors), or `http.url` path patterns.

**X-Ray Groups** [🔗](https://docs.aws.amazon.com/xray/latest/devguide/xray-groups.html) let you save a filter expression as a named group. Groups serve two purposes: they make it easy to consistently view a subset of traces (e.g., all traces for a specific service or customer segment), and they can have their own **CloudWatch metrics** (request count, error rate, latency) published automatically — enabling alarms and dashboards scoped to that group.

### X-Ray with OpenTelemetry

AWS supports the **OpenTelemetry** standard as a vendor-neutral alternative to the X-Ray SDK for instrumentation [🔗](https://aws-otel.github.io/). The **AWS Distro for OpenTelemetry (ADOT)** is AWS's distribution of the OpenTelemetry collector and SDKs, pre-configured to export traces to X-Ray (as well as metrics to CloudWatch and other backends). If you're building a system that might need to send traces to multiple backends (X-Ray today, Jaeger or Honeycomb tomorrow), ADOT is the approach to use — your instrumentation code stays the same regardless of where the data is sent. For the exam, know that ADOT exists and that X-Ray is compatible with it, but the X-Ray SDK remains the most commonly tested instrumentation path.

{{< qcm >}}
[
{
"question": "A developer is building a microservices application on AWS. When a user places an order, the request passes through API Gateway, a Lambda function, DynamoDB, and an SQS queue. The team wants to identify where latency is being introduced in this chain. Which AWS service should they use?",
"answers": [
{
"answer": "AWS X-Ray",
"isCorrect": true,
"explanation": "X-Ray is designed exactly for this use case: tracing end-to-end requests across distributed systems and visualizing how long each service hop takes, making it easy to pinpoint latency."
},
{
"answer": "Amazon CloudWatch Logs",
"isCorrect": false,
"explanation": "CloudWatch Logs can capture individual service logs, but correlating them across multiple services to identify latency is very difficult without a distributed tracing tool like X-Ray."
},
{
"answer": "AWS CloudTrail",
"isCorrect": false,
"explanation": "CloudTrail records API calls for auditing and governance purposes, not for tracing request latency across microservices."
},
{
"answer": "Amazon EventBridge",
"isCorrect": false,
"explanation": "EventBridge is an event bus service used for routing events between services, not for distributed tracing or latency analysis."
}
]
},
{
"question": "In AWS X-Ray, what is a 'segment'?",
"answers": [
{
"answer": "A single end-to-end request journey across all services",
"isCorrect": false,
"explanation": "This describes a trace, not a segment. A trace encompasses the entire journey and is composed of multiple segments."
},
{
"answer": "One service's contribution to a trace, recording timing, HTTP metadata, and errors",
"isCorrect": true,
"explanation": "A segment represents the work done by a single instrumented service (e.g., a Lambda function or an EC2 app) within a trace. It captures timing, metadata, and error information for that service."
},
{
"answer": "A fine-grained unit within a service used to time individual downstream calls",
"isCorrect": false,
"explanation": "This describes a subsegment, which exists within a segment and provides more granular visibility (e.g., timing a single DynamoDB call)."
},
{
"answer": "A sampling rule that determines which requests are traced",
"isCorrect": false,
"explanation": "Sampling rules control which requests are recorded. They are a separate concept unrelated to the definition of a segment."
}
]
},
{
"question": "A developer wants to trace a DynamoDB GetItem call made inside an AWS Lambda function using X-Ray. What is the correct approach in Node.js?",
"answers": [
{
"answer": "Replace `require('aws-sdk')` with `AWSXRay.captureAWS(require('aws-sdk'))`",
"isCorrect": true,
"explanation": "Wrapping the AWS SDK with captureAWS causes the X-Ray SDK to automatically create subsegments for every downstream AWS service call, including DynamoDB."
},
{
"answer": "Add an X-Ray annotation with the key 'DynamoDB' before each call",
"isCorrect": false,
"explanation": "Annotations are used to add searchable metadata to traces, not to instrument or capture downstream service calls automatically."
},
{
"answer": "Enable active tracing in the Lambda configuration — no code changes are needed",
"isCorrect": false,
"explanation": "Enabling active tracing in Lambda configuration makes Lambda emit a segment for the invocation, but SDK instrumentation (captureAWS) is still required to capture downstream calls like DynamoDB as subsegments."
},
{
"answer": "Install the X-Ray daemon on the Lambda execution environment",
"isCorrect": false,
"explanation": "On Lambda, AWS manages the X-Ray daemon automatically. You do not install it manually. SDK instrumentation in code is what captures downstream calls."
}
]
},
{
"question": "How does the X-Ray SDK send trace data to the X-Ray service?",
"answers": [
{
"answer": "It sends trace data directly to the X-Ray API over HTTPS from the application",
"isCorrect": false,
"explanation": "The SDK does not call the X-Ray API directly. This would couple the application to network latency on every request."
},
{
"answer": "It buffers trace data and sends it over UDP to a locally running X-Ray daemon, which then forwards it to the X-Ray service",
"isCorrect": true,
"explanation": "The SDK sends data via UDP to the local X-Ray daemon process. The daemon batches and forwards it asynchronously to the X-Ray service, decoupling the application from API latency."
},
{
"answer": "It writes trace data to CloudWatch Logs, which X-Ray reads from",
"isCorrect": false,
"explanation": "X-Ray has its own data pipeline via the daemon. It does not rely on CloudWatch Logs as an intermediary for trace data."
},
{
"answer": "It stores trace data in an S3 bucket, which X-Ray polls periodically",
"isCorrect": false,
"explanation": "X-Ray does not use S3 as a transport mechanism. Traces are sent via UDP to the daemon, then forwarded to the X-Ray API."
}
]
},
{
"question": "A developer is running an application on Amazon ECS and wants to enable X-Ray tracing. How should the X-Ray daemon be deployed?",
"answers": [
{
"answer": "As a sidecar container in the same ECS task, with the application sending segments to localhost:2000 over UDP",
"isCorrect": true,
"explanation": "The recommended pattern for ECS is to run the X-Ray daemon as a sidecar container within the same task definition. The application container sends UDP data to localhost:2000 where the daemon listens."
},
{
"answer": "It is automatically managed by ECS — no configuration is needed",
"isCorrect": false,
"explanation": "Unlike Lambda, ECS does not automatically manage the X-Ray daemon. You must explicitly configure and run it as a sidecar container."
},
{
"answer": "Install the daemon on the underlying EC2 host instance",
"isCorrect": false,
"explanation": "While technically possible, this is not the recommended approach for ECS. The sidecar container pattern is the correct and standard solution."
},
{
"answer": "Enable X-Ray in the ECS cluster settings via the AWS console",
"isCorrect": false,
"explanation": "There is no single ECS cluster setting to enable X-Ray. The daemon must be configured as a sidecar container in the task definition."
}
]
},
{
"question": "What is the difference between X-Ray annotations and X-Ray metadata? (Select TWO)",
"answers": [
{
"answer": "Annotations are indexed and can be used in filter expressions to search traces",
"isCorrect": true,
"explanation": "Annotations are key-value pairs (string, number, or boolean) that X-Ray indexes, making them searchable via filter expressions in the console or API."
},
{
"answer": "Metadata is indexed and supports complex filter queries",
"isCorrect": false,
"explanation": "Metadata is NOT indexed. It is recorded for diagnostic purposes and can be inspected on a specific trace, but cannot be used in filter expressions."
},
{
"answer": "Metadata can store arbitrary JSON-serializable values, making it suitable for rich diagnostic data",
"isCorrect": true,
"explanation": "Unlike annotations (limited to string, number, boolean), metadata accepts any JSON-serializable value — making it ideal for storing full request payloads or configuration snapshots."
},
{
"answer": "Annotations can store any JSON object structure",
"isCorrect": false,
"explanation": "Annotations are limited to simple key-value pairs with string, number, or boolean values. Complex objects must be stored as metadata."
},
{
"answer": "Both annotations and metadata can be used in X-Ray filter expressions",
"isCorrect": false,
"explanation": "Only annotations are indexed and usable in filter expressions. Metadata cannot be used for searching or filtering traces."
}
]
},
{
"question": "A developer wants to find all X-Ray traces where a custom attribute `orderStatus` equals `FAILED`. Which approach enables this?",
"answers": [
{
"answer": "Store `orderStatus` as X-Ray metadata and query it using the filter expression `metadata.orderStatus = \"FAILED\"`",
"isCorrect": false,
"explanation": "Metadata is not indexed and cannot be used in filter expressions. Querying by metadata value is not supported."
},
{
"answer": "Store `orderStatus` as an X-Ray annotation and use the filter expression `annotation.orderStatus = \"FAILED\"`",
"isCorrect": true,
"explanation": "Annotations are indexed by X-Ray, which allows them to be queried using filter expressions in the console or API. This is the correct approach for searchable custom attributes."
},
{
"answer": "Enable X-Ray Groups with a tag filter on `orderStatus`",
"isCorrect": false,
"explanation": "X-Ray Groups use filter expressions, but the underlying attribute must first be stored as an annotation to be filterable. Tags are not a relevant concept here."
},
{
"answer": "Use CloudWatch Logs Insights to query the X-Ray trace logs",
"isCorrect": false,
"explanation": "X-Ray has its own filter expression system for searching traces. CloudWatch Logs Insights is not used to query X-Ray trace attributes."
}
]
},
{
"question": "What does the X-Ray Service Map display?",
"answers": [
{
"answer": "A visual graph of all traced services, showing request rates, error/fault rates, and average response times per service",
"isCorrect": true,
"explanation": "The Service Map dynamically generates a graph of every service involved in traced requests, with nodes displaying request rate, 4xx/5xx error rates, and average latency — making it easy to identify bottlenecks or error sources."
},
{
"answer": "A list of all AWS resources in the account and their health status",
"isCorrect": false,
"explanation": "The Service Map is scoped to services that appear in X-Ray traces, not all AWS resources in the account. AWS Health Dashboard or Resource Explorer serve that broader purpose."
},
{
"answer": "A timeline showing the sequence of CloudTrail API calls",
"isCorrect": false,
"explanation": "CloudTrail tracks API calls for auditing. The X-Ray Service Map is about request flow and performance in distributed applications, not audit logging."
},
{
"answer": "A Gantt-style breakdown of a single trace's segments and subsegments",
"isCorrect": false,
"explanation": "This describes the trace timeline view within the X-Ray console. The Service Map is a higher-level graph across all services, not a per-trace breakdown."
}
]
},
{
"question": "What is the default X-Ray sampling rule behavior?",
"answers": [
{
"answer": "100% of all requests are traced",
"isCorrect": false,
"explanation": "Tracing 100% of requests would be expensive in high-traffic systems. The default rule samples a representative subset, not every request."
},
{
"answer": "The first request per second plus 5% of additional requests",
"isCorrect": true,
"explanation": "X-Ray's default sampling rule records the first request each second and 5% of subsequent requests. This balances observability with cost."
},
{
"answer": "1% of all requests, with no guaranteed first request",
"isCorrect": false,
"explanation": "The default is not a flat 1% rate. It guarantees one trace per second and samples 5% of the remainder."
},
{
"answer": "10% of requests, configurable only by redeploying the application",
"isCorrect": false,
"explanation": "The default rate is not 10%, and sampling rules are configured centrally in the X-Ray console and pulled at runtime — no redeployment is needed to change them."
}
]
},
{
"question": "A team wants to trace 100% of requests to the `/checkout` endpoint but only 1% of requests to `/healthcheck`. How should this be configured in X-Ray?",
"answers": [
{
"answer": "Use custom sampling rules with URL path conditions, evaluated in priority order",
"isCorrect": true,
"explanation": "X-Ray supports custom sampling rules with conditions including service name, HTTP method, URL path, and host. Rules are evaluated by priority, so specific paths like /checkout can be given higher sample rates than others like /healthcheck."
},
{
"answer": "Deploy two separate X-Ray daemons, one per endpoint",
"isCorrect": false,
"explanation": "Sampling is controlled by rules in the X-Ray console, not by running multiple daemons. A single daemon handles all traffic."
},
{
"answer": "Modify the application code to conditionally call the X-Ray SDK based on the request path",
"isCorrect": false,
"explanation": "While theoretically possible, this is not the recommended approach. X-Ray provides built-in sampling rule configuration that handles this centrally without code changes."
},
{
"answer": "Sampling rules can only be based on request rate, not URL path",
"isCorrect": false,
"explanation": "Sampling rules support conditions on service name, HTTP method, URL path, and host — not just request rate."
}
]
},
{
"question": "A developer updates the X-Ray sampling rules in the AWS console to reduce sampling from 10% to 1% for a specific endpoint. How does this change take effect?",
"answers": [
{
"answer": "The application and daemon pull the updated rules at runtime — no redeployment is needed",
"isCorrect": true,
"explanation": "Sampling rules are configured centrally and pulled by the SDK/daemon at runtime. Changes apply without redeploying the application."
},
{
"answer": "The application must be redeployed for the new sampling rules to take effect",
"isCorrect": false,
"explanation": "One of the key advantages of X-Ray's sampling rule system is that rules are applied dynamically at runtime, eliminating the need for redeployment."
},
{
"answer": "The X-Ray daemon must be manually restarted after changing sampling rules",
"isCorrect": false,
"explanation": "The daemon periodically pulls updated sampling rules from the X-Ray service automatically. A manual restart is not required."
},
{
"answer": "Sampling rules are baked into the X-Ray SDK version — a version upgrade is required",
"isCorrect": false,
"explanation": "Sampling rules are not tied to the SDK version. They are centrally managed in the X-Ray console and fetched at runtime by the daemon."
}
]
},
{
"question": "How is X-Ray tracing enabled for an AWS Lambda function? (Select TWO)",
"answers": [
{
"answer": "Enable active tracing in the Lambda function configuration",
"isCorrect": true,
"explanation": "Enabling active tracing in the Lambda configuration tells Lambda to automatically create a segment for each invocation and manage the X-Ray daemon."
},
{
"answer": "Use the X-Ray SDK to instrument downstream calls within the function code",
"isCorrect": true,
"explanation": "While Lambda handles the segment automatically, the SDK must still be used in code (e.g., captureAWS) to capture subsegments for downstream calls like DynamoDB or HTTP requests."
},
{
"answer": "Install the X-Ray daemon manually inside the Lambda execution environment",
"isCorrect": false,
"explanation": "On Lambda, AWS manages the X-Ray daemon automatically. Manual installation is not required or possible."
},
{
"answer": "Add a Lambda Layer containing the X-Ray daemon binary",
"isCorrect": false,
"explanation": "The X-Ray daemon is managed by AWS on Lambda. You use Lambda Layers to add SDK libraries if needed, but not to provide the daemon."
}
]
},
{
"question": "A developer needs to enable X-Ray tracing on an Elastic Beanstalk environment. What is the correct approach?",
"answers": [
{
"answer": "SSH into the EC2 instances and manually install the X-Ray daemon",
"isCorrect": false,
"explanation": "Elastic Beanstalk manages the X-Ray daemon for you. Manual installation via SSH is unnecessary and not the recommended approach."
},
{
"answer": "Enable X-Ray tracing via the Elastic Beanstalk console or a `.ebextensions` configuration",
"isCorrect": true,
"explanation": "Elastic Beanstalk provides a native option to enable X-Ray, either through the console or an .ebextensions config file. Once enabled, Beanstalk manages the daemon automatically."
},
{
"answer": "Deploy the X-Ray daemon as a sidecar container alongside the application",
"isCorrect": false,
"explanation": "The sidecar pattern is specific to ECS. On Elastic Beanstalk, the daemon is managed by the platform itself."
},
{
"answer": "X-Ray cannot be used with Elastic Beanstalk",
"isCorrect": false,
"explanation": "X-Ray integrates natively with Elastic Beanstalk. It is one of the explicitly supported environments."
}
]
},
{
"question": "What is the purpose of X-Ray Groups?",
"answers": [
{
"answer": "To group Lambda functions and EC2 instances into logical clusters for cost allocation",
"isCorrect": false,
"explanation": "X-Ray Groups are not related to cost allocation or resource grouping. They are a tracing feature based on filter expressions."
},
{
"answer": "To save a filter expression as a named group, enabling consistent trace views and scoped CloudWatch metrics",
"isCorrect": true,
"explanation": "X-Ray Groups persist a filter expression under a name. They allow teams to consistently view a subset of traces and automatically publish CloudWatch metrics (request count, error rate, latency) for that group, enabling targeted alarms and dashboards."
},
{
"answer": "To define IAM permission boundaries for X-Ray trace access",
"isCorrect": false,
"explanation": "X-Ray Groups are not an IAM or access control mechanism. Access control is handled separately through IAM policies."
},
{
"answer": "To batch multiple traces together for bulk export to S3",
"isCorrect": false,
"explanation": "X-Ray Groups are for filtering and viewing traces and generating CloudWatch metrics — not for batch export."
}
]
},
{
"question": "A developer uses the X-Ray filter expression `responsetime > 2` in the X-Ray console. What does this return?",
"answers": [
{
"answer": "All traces where the total response time exceeded 2 seconds",
"isCorrect": true,
"explanation": "X-Ray filter expressions support querying by response time, errors, faults, annotations, and more. `responsetime > 2` returns traces that took longer than 2 seconds."
},
{
"answer": "All traces that resulted in a 2xx HTTP status code",
"isCorrect": false,
"explanation": "HTTP status codes are filtered with different expressions (e.g., `error` for 4xx, `fault` for 5xx). `responsetime` refers to duration in seconds, not status codes."
},
{
"answer": "All traces where more than 2 subsegments were recorded",
"isCorrect": false,
"explanation": "`responsetime` is a duration-based filter, not a count of subsegments."
},
{
"answer": "All traces where the annotation `responsetime` is greater than 2",
"isCorrect": false,
"explanation": "`responsetime` is a built-in X-Ray field, not a custom annotation. It refers to the actual measured response duration of the trace."
}
]
},
{
"question": "What is the AWS Distro for OpenTelemetry (ADOT) and when should a developer consider using it with X-Ray?",
"answers": [
{
"answer": "ADOT is AWS's distribution of the OpenTelemetry collector, useful when the application may need to send traces to multiple backends beyond X-Ray",
"isCorrect": true,
"explanation": "ADOT is pre-configured to export to X-Ray and other backends (e.g., Jaeger, Honeycomb). If vendor neutrality or multi-backend support is needed, ADOT lets you keep the same instrumentation code regardless of destination."
},
{
"answer": "ADOT replaces the X-Ray daemon and must be used instead of it on all AWS services",
"isCorrect": false,
"explanation": "ADOT is an alternative instrumentation approach, not a mandatory replacement for the X-Ray daemon. The X-Ray SDK and daemon remain valid and commonly used."
},
{
"answer": "ADOT is only compatible with on-premises environments and cannot send data to X-Ray",
"isCorrect": false,
"explanation": "ADOT is explicitly designed to work with AWS services and can export traces directly to X-Ray."
},
{
"answer": "ADOT is a CloudWatch agent extension with no relation to distributed tracing",
"isCorrect": false,
"explanation": "ADOT is specifically for distributed tracing (and metrics), built on the OpenTelemetry standard. It is not an extension of the CloudWatch agent."
}
]
},
{
"question": "Which X-Ray concept uniquely identifies a single end-to-end request and is propagated across service boundaries via an HTTP header?",
"answers": [
{
"answer": "Segment",
"isCorrect": false,
"explanation": "A segment represents one service's contribution within a trace. It does not span service boundaries on its own."
},
{
"answer": "Trace",
"isCorrect": true,
"explanation": "A trace represents the full end-to-end journey of a request. It is identified by a unique `X-Amzn-Trace-Id` header that propagates across service boundaries, allowing X-Ray to stitch all segments together."
},
{
"answer": "Subsegment",
"isCorrect": false,
"explanation": "A subsegment is a finer-grained unit within a single segment, used to capture individual downstream calls. It does not span across services."
},
{
"answer": "Group",
"isCorrect": false,
"explanation": "A group is a saved filter expression for viewing subsets of traces. It is not a request identifier."
}
]
},
{
"question": "A developer wants to capture the time taken by a specific block of business logic inside a Lambda function — separate from the overall Lambda invocation segment. Which X-Ray concept should they use?",
"answers": [
{
"answer": "A new Trace",
"isCorrect": false,
"explanation": "A trace is a full end-to-end request journey. You would not create a new trace for a sub-operation within the same request."
},
{
"answer": "An Annotation",
"isCorrect": false,
"explanation": "Annotations are key-value pairs for adding searchable metadata to a segment. They do not capture timing for a block of logic."
},
{
"answer": "A Subsegment",
"isCorrect": true,
"explanation": "Subsegments provide finer-grained visibility within a segment. They can be created manually to time a block of custom application logic, in addition to being generated automatically for downstream calls."
},
{
"answer": "A Service Map node",
"isCorrect": false,
"explanation": "Service Map nodes represent entire services in the trace graph. They are not used to instrument individual blocks of code."
}
]
}
]
{{< /qcm >}}