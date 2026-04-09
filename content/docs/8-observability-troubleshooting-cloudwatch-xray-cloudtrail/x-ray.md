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