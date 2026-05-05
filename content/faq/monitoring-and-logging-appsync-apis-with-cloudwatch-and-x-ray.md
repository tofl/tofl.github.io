---
title: "Monitoring and Logging AppSync APIs with CloudWatch and X-Ray"
---

## Monitoring and Logging AppSync APIs with CloudWatch and X-Ray

When you deploy a GraphQL API using AWS AppSync, you're not just creating endpoints—you're introducing a complex, distributed system that connects resolvers, data sources, and business logic. Things will break. Queries will timeout. Resolvers will fail in ways you never anticipated. Without proper observability, you'll find yourself flying blind when production issues arise.

This article walks you through the complete observability story for AppSync: how to instrument your APIs with CloudWatch logging, understand the detailed structure of resolver execution logs, leverage CloudWatch metrics to track API health, and use AWS X-Ray to trace requests across your entire stack. By the end, you'll know exactly how to diagnose what's happening inside your AppSync API and fix it fast.

### Why Observability Matters for AppSync

AppSync sits at an interesting architectural crossroads. It's a managed GraphQL service, so AWS handles the infrastructure, but you're responsible for resolver logic, data source configuration, and the flow of data through your API. When something goes wrong, the problem could be in your resolver code, your data source connection, your authentication rules, or the downstream services you're calling.

Without visibility into what's happening, you're reduced to guessing. Did the Lambda resolver time out? Did DynamoDB return an error? Was the request even properly authenticated? CloudWatch and X-Ray give you the answers.

### Enabling CloudWatch Logs for AppSync

The first step toward visibility is enabling CloudWatch Logs. AppSync can log at two granularity levels: you can log all resolver execution, or you can enable logging for specific fields in your schema. Both approaches feed into CloudWatch.

To enable logging, navigate to your AppSync API in the AWS Management Console and look for the "Logging" section. You'll need an IAM role that allows AppSync to write to CloudWatch Logs. AWS provides a managed policy for this (`AmazonAppSyncLogsRole`), but if you're following least-privilege principles, you'll create a custom role that permits `logs:CreateLogGroup`, `logs:CreateLogStream`, and `logs:PutLogEvents` on the specific log group for your API.

Once you enable logging, AppSync creates a CloudWatch log group following the pattern `/aws/appsync/apis/<api-id>`. Every resolver execution—successful or failed—gets logged here. You can also set the log level to `ERROR` to reduce noise and cost, or set it to `ALL` to capture everything. For development and debugging, `ALL` is invaluable; for production, you might start with `ERROR` and adjust based on what you need to investigate.

### Understanding Resolver Execution Logs

A resolver execution log isn't just a simple line of text. It's a rich JSON structure that tells you exactly what happened during each stage of resolver processing. Understanding this structure is critical for debugging.

Here's what a typical resolver execution log entry looks like (simplified for clarity):

```json
{
  "requestId": "abc123def456",
  "typeName": "Query",
  "fieldName": "getUser",
  "resolverArn": "arn:aws:appsync:...",
  "duration": 245,
  "traceId": "1-xyz789-abc",
  "logs": [
    "Starting resolver execution",
    "Mapping template evaluation succeeded",
    "Invoke Lambda function: arn:aws:lambda:...",
    "Lambda invocation succeeded",
    "Transformation template evaluation succeeded"
  ],
  "errors": []
}
```

The `duration` field shows how long the entire resolver took in milliseconds. The `logs` array shows the sequence of operations—this is your window into what the resolver actually did. The `errors` array contains any errors that occurred; even if the resolver returned a partial response, errors here tell you what went wrong.

The structure becomes richer when you look at the actual execution stages. AppSync resolves fields in distinct phases: the request mapping template transforms the GraphQL arguments into a format your data source understands, the data source is invoked (whether that's DynamoDB, Lambda, HTTP, or something else), and the response mapping template transforms the result back into GraphQL format. Each phase is logged separately, which means you can pinpoint exactly where a failure occurred.

When a resolver fails due to a mapping template error, you'll see something like this in the logs:

```
Mapping template error: Unsupported operand type(s) for +: 'str' and 'int'
```

This tells you that your request mapping template tried an invalid operation—perhaps you're trying to concatenate strings and numbers without proper type conversion. The fix is straightforward: review your VTL (Velocity Template Language) code.

When a Lambda resolver fails, the logs might show:

```
Lambda function returned error: {"errorMessage": "User not found", "errorType": "UserNotFoundError"}
```

This tells you the Lambda function executed but returned an error response. The difference matters: a Lambda function that crashes looks different from one that returns an error object. Understanding the distinction helps you know whether to look at your Lambda function's CloudWatch logs (for crashes) or your resolver's error handling (for intentional errors).

### CloudWatch Metrics: Tracking API Health

Beyond logs, AppSync publishes metrics to CloudWatch that help you understand your API's health at a glance. These metrics are invaluable for building dashboards and creating alarms.

The primary metrics you'll work with are:

**4XXError** is incremented when a request fails due to client-side issues—malformed GraphQL, authentication failures, or validation errors. A spike in 4XXErrors might indicate that clients are sending bad queries, or that your authentication layer has changed.

**5XXError** is incremented when something goes wrong on your side—resolver failures, data source errors, or timeout. This is the metric you should alarm on. If 5XXErrors are rising, something is breaking in your API.

**Latency** measures the total time from request to response, in milliseconds. This metric is bucketed into percentiles, so you can see the p50, p90, and p99 latencies. If your p99 latency is creeping up, you might have a slow resolver or a downstream dependency issue.

**ConnectSuccess** applies specifically to subscriptions. It counts successful WebSocket connection attempts. This is useful for monitoring real-time features; a drop in ConnectSuccess might indicate that clients are having trouble subscribing.

These metrics are automatically published; you don't need to instrument your code. They're available in CloudWatch Metrics under the `AWS/AppSync` namespace, grouped by API ID and operation name.

Creating a CloudWatch dashboard is straightforward. You can plot 4XXError and 5XXError together to see your error rate, add Latency percentiles to track performance, and include ConnectSuccess to monitor subscriptions. If you're using infrastructure-as-code, you can define these dashboards in CloudFormation or CDK, making them part of your deployment pipeline.

### Diving Deeper: Field-Level Logging

While API-level logging gives you a global view, sometimes you need granular insights. AppSync allows you to enable detailed logging for specific fields in your schema. This is useful when you suspect a particular resolver is problematic.

To enable field-level logging, you configure logging behavior in your AppSync API's logging settings, specifying which fields should have their resolver execution fully logged. When you do this, only the specified resolvers generate detailed logs, which reduces CloudWatch costs and noise while still giving you the visibility you need.

For example, you might enable detailed logging for a `getUser` query that's been causing issues in production. Every time that resolver executes, you'll see the full execution trace, mapping template inputs and outputs, and any errors. This is far more efficient than enabling all-resolver logging when you're just debugging one problem.

### AWS X-Ray: Tracing Across Your Stack

CloudWatch Logs and Metrics show you what happened in AppSync, but your API doesn't exist in isolation. A single GraphQL query might invoke Lambda functions, query DynamoDB, call external APIs, and touch several AWS services. To understand the full picture, you need X-Ray.

X-Ray is AWS's distributed tracing service. When enabled, it traces requests as they flow through your entire stack, capturing timing information for each service involved. For AppSync, X-Ray tracing shows you not just the overall resolver execution, but the time spent in the request mapping template, the time spent calling a Lambda function, and the time spent in the response mapping template—all as a visual timeline.

Enabling X-Ray for AppSync is simple: in the API settings, toggle "Enable tracing." AppSync will automatically begin sending trace data to X-Ray. The data flows into the default X-Ray service map and traces, where you can query by request ID to see exactly what happened.

Once enabled, a single GraphQL request generates a trace that might look like this: AppSync receives the request (1ms), executes the request mapping template (5ms), invokes a Lambda function (150ms), the Lambda function queries DynamoDB (30ms), AppSync executes the response mapping template (3ms), and the response is sent back (total 189ms).

This view is invaluable for performance debugging. If your Lambda function is taking 150ms and DynamoDB is taking 30ms, you know the other 120ms is spent in your Lambda function code—perhaps a loop, an API call, or database setup logic.

### Connecting AppSync to X-Ray with Data Sources

To get the full value of X-Ray, you need to trace through your data sources. If you're using Lambda data sources, X-Ray automatically traces the Lambda invocation, so you can see how much time the function itself consumed versus how much time AppSync spent setting up the invocation.

For HTTP data sources, X-Ray shows you the HTTP request's duration, which is helpful for debugging slow third-party APIs.

For DynamoDB and other AWS service data sources, you need to ensure those services are also X-Ray enabled. This often requires configuration on the Lambda function side—if a Lambda resolver is calling DynamoDB, the Lambda function itself needs to import the X-Ray SDK and use it to instrument the DynamoDB client. Fortunately, the AWS SDK for Node.js, Python, and Java have straightforward X-Ray integration; you typically just wrap the SDK client with X-Ray's wrapper function.

For example, in Node.js, you'd do:

```javascript
const AWSXRay = require('aws-xray-sdk-core');
const AWS = require('aws-sdk');

const dynamodb = AWSXRay.captureClientAPI(new AWS.DynamoDB.DocumentClient());
```

With this in place, DynamoDB calls made through that client are automatically traced, and you'll see DynamoDB service calls appear in the X-Ray service map alongside your Lambda and AppSync traces.

### Debugging Failing Resolvers: A Practical Workflow

Let's walk through a realistic scenario. You've deployed a new GraphQL API, and your monitoring shows an increasing rate of 5XXErrors on a particular mutation. Users are complaining that they can't update their profile. Here's how you'd diagnose and fix it.

First, check the CloudWatch dashboard. You see that the error rate on the `updateProfile` mutation started spiking about 30 minutes ago. Navigate to the CloudWatch Logs for your AppSync API and filter by the resolver execution logs for that mutation.

Looking at a few sample logs, you see that some requests have errors in the response mapping template:

```
Transformation template evaluation failed: Cannot read property 'id' of undefined
```

This tells you that the Lambda function is returning a response that doesn't have an `id` property, but your response mapping template expects it. You check the response mapping template:

```vtl
{
  "id": $input.path('$.id'),
  "name": $input.path('$.name')
}
```

The issue is clear: you're expecting an `id` field in the Lambda response, but it's not always there. You need to either update the Lambda function to always return an `id`, or make your response mapping template more defensive:

```vtl
{
  "id": $input.path('$.id') ?: "unknown",
  "name": $input.path('$.name') ?: "unnamed"
}
```

Now you deploy the fix. You check the metrics again and see the error rate dropping. Within a few minutes, 5XXErrors return to zero.

But what if the issue was more subtle? Suppose the Lambda function is calling DynamoDB, and DynamoDB is occasionally rate-limited. You'd see errors in the logs, but they'd be coming from DynamoDB, not from your resolver code. This is where X-Ray shines. You'd open the X-Ray service map, filter traces by the error rate, and see that DynamoDB calls are timing out. This tells you to either optimize your DynamoDB queries (perhaps adding an index) or increase provisioned capacity.

### Monitoring Subscriptions

Subscriptions add another layer of complexity to observability. Unlike queries and mutations, which are request-response, subscriptions maintain a long-lived WebSocket connection. A client connects, establishes a subscription, and receives updates until it disconnects.

The `ConnectSuccess` metric tracks how many WebSocket connections were successfully established. If this metric drops, clients are having trouble subscribing.

The `4XXError` and `5XXError` metrics still apply to subscriptions, but they're logged slightly differently. A 5XXError on a subscription might indicate that the initial subscription resolver failed, or that a subsequent data source call triggered by a real-time event failed.

For subscriptions, CloudWatch Logs are particularly useful for debugging connection failures. If a client can't establish a subscription, the logs will show you exactly why—perhaps the request mapping template failed, or authentication was denied.

X-Ray also traces subscriptions, though the traces are more granular. Each subscription operation—the initial subscription resolver, and each subsequent data delivery—generates its own trace segment, allowing you to see which specific operation is failing or slow.

### Cost Considerations

CloudWatch Logs and X-Ray both have associated costs. Logs are charged per gigabyte ingested and stored, while X-Ray charges per million traces recorded. For high-traffic APIs, these costs can become significant.

To optimize, consider enabling detailed logging only for problematic resolvers, not for all resolvers. In production, use the `ERROR` log level to capture only failures, and selectively enable `ALL` logging when debugging. You can also use log group retention policies to automatically delete old logs after a set period, reducing storage costs.

For X-Ray, sampling is your friend. X-Ray allows you to define sampling rules that determine what percentage of requests are traced. You might trace all requests in development, but only 10% of requests in production—enough to catch issues without excessive cost.

### Best Practices for AppSync Observability

Build observability into your API from day one. Don't wait for production issues to force you to think about monitoring. Enable CloudWatch logging and X-Ray in your development environment, and make sure your team knows how to read the logs and traces.

Create CloudWatch dashboards that show the key metrics for your API: error rate, latency percentiles, and subscription connection success. Share these dashboards with your team, and review them regularly. Trends in these metrics often precede user complaints, giving you time to address issues proactively.

Set up CloudWatch alarms for critical metrics. Alert when 5XXErrors exceed a threshold, or when latency percentiles spike. These alarms should trigger notifications that reach the right people on your team.

Document your API's expected behavior in CloudWatch Logs. If you know that a particular resolver sometimes returns null values (and that's okay), document it. If you expect certain validation errors under specific conditions, document them. This context helps your team understand what's normal and what's a genuine problem.

Test your monitoring and alerting in a staging environment before deploying to production. You want to know that your alarms actually trigger and that your team knows how to respond to them. Practicing incident response in a safe environment builds confidence and reduces response time when real issues occur.

### Conclusion

Observability for AppSync is about creating layers of visibility into your API. CloudWatch Logs give you the detailed execution traces that tell you exactly what happened in each resolver. CloudWatch Metrics provide high-level health indicators that help you spot problems quickly. X-Ray ties it all together, showing you how requests flow through your entire stack and where time is being spent.

With these tools in place, production issues become solvable problems rather than mysteries. You can diagnose issues in minutes instead of hours, make confident changes based on data, and build systems that your team trusts. Start simple—enable logging and basic metrics—and deepen your observability as your API grows and your needs evolve.
