---
title: "API Gateway Request/Response Transformations Without Lambda"
---

## API Gateway Request/Response Transformations Without Lambda

Every millisecond counts in modern APIs. When your API Gateway receives a request, it doesn't always need to hand off work to a Lambda function just to reshape some JSON or add a header. AWS provides native transformation capabilities directly within API Gateway itself—capabilities that are often overlooked but can dramatically reduce latency, eliminate cold starts, and save you money. This is where mapping templates and direct integrations become your secret weapon for building lean, efficient APIs.

Let's explore how to transform requests and responses at the gateway layer, when this approach makes sense, and when you should step back and reach for Lambda instead.

### Understanding API Gateway's Native Transformation Capabilities

API Gateway sits at the front door of your application. Before any traffic reaches your backend, whether that's a Lambda function, an HTTP endpoint, an AWS service, or anything else, the gateway has an opportunity to inspect and modify the traffic flowing through it.

For REST APIs, this transformation capability comes from **Velocity Template Language (VTL) mapping templates**. These are essentially small transformation scripts written in a template syntax that can inspect incoming requests, extract data, reformat payloads, and even invoke AWS services directly without touching Lambda. For HTTP APIs, you have **parameter mapping** and the ability to use direct integrations for certain AWS services, which trades flexibility for simplicity and lower latency.

The core insight here is that mapping templates run within the API Gateway service itself. There's no function invocation, no cold start, no separate billing. They're simply part of the request/response flow, executed with the same speed as the gateway processes any request.

### VTL Mapping Templates for REST APIs

REST APIs in API Gateway leverage Velocity Template Language for transformations. VTL is a simple templating language originally designed for Java, and it's surprisingly expressive for common transformation tasks.

#### How VTL Mapping Templates Work

When you set up an integration with a resource method in a REST API, you can attach two mapping templates: one for the request (to transform what you send to the backend) and one for the response (to transform what comes back). Each template has access to variables representing the incoming request and outgoing response.

For a request mapping template, you have access to variables like `$input.path()` to extract JSON fields, `$input.params()` to access query strings and headers, and `$util` for utility functions. The template outputs a payload that becomes the actual request sent to your integration target.

Let's say you have a REST API that receives user data but your backend expects a slightly different schema. Your frontend sends:

```json
{
  "fullName": "Alice Johnson",
  "emailAddress": "alice@example.com",
  "phoneNumber": "+1-555-0100"
}
```

But your Lambda function (or HTTP backend) expects:

```json
{
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "phone": "+1-555-0100"
}
```

You'd write a request mapping template like this:

```
{
  "name": "$input.path('$.fullName')",
  "email": "$input.path('$.emailAddress')",
  "phone": "$input.path('$.phoneNumber')"
}
```

API Gateway automatically parses the incoming JSON and applies the template. The `$input.path()` function extracts values using JSONPath syntax, and the template outputs the reformatted payload—all before hitting your backend.

#### Common Transformation Patterns

**Adding Headers to Requests**: If your backend requires authentication headers or tracking headers that you want to inject at the gateway, you can do this in a mapping template. For example, to add a correlation ID:

```
#set($correlationId = $util.randomUuid())
{
  "body": $input.json('$'),
  "correlationId": "$correlationId"
}
```

The `$util.randomUuid()` function generates a unique identifier, and you're embedding it in the outgoing request.

**Extracting and Transforming Response Data**: Response mapping templates work similarly. If your backend returns a complex structure but clients only need certain fields, you can slim down the response:

```
{
  "userId": $input.path('$.data.user.id'),
  "userName": $input.path('$.data.user.profile.name'),
  "createdAt": $input.path('$.data.metadata.timestamp')
}
```

**Conditionally Transforming Data**: VTL supports if-else logic. You might transform a field differently based on another field's value:

```
{
  "status": "$input.path('$.status')",
  "priority": #if($input.path('$.urgency') == 'critical') "high" #else "normal" #end
}
```

**Handling Arrays and Loops**: VTL's foreach loop lets you iterate through arrays. If your backend returns paginated results but you need to flatten them:

```
{
  "items": [
    #foreach($item in $input.path('$.results'))
      {
        "id": $item.id,
        "name": "$item.displayName"
      }#if($foreach.hasNext),#end
    #end
  ]
}
```

#### When VTL Excels

Mapping templates shine for transformations that are deterministic and don't require business logic. Adding a header, extracting fields, reformatting JSON, combining data from multiple fields—these are all fair game. The transformations happen in microseconds, with zero cold start penalty, and they cost nothing beyond your API Gateway pricing.

### Direct Integrations for HTTP APIs

HTTP APIs represent AWS's newer, streamlined API Gateway offering. They're faster and cheaper than REST APIs, but they have fewer features. Where HTTP APIs truly shine is in their support for direct integrations to AWS services.

With a direct integration, you can connect an HTTP API endpoint straight to services like DynamoDB, SNS, SQS, or Kinesis without writing a Lambda function. The HTTP API handles parameter mapping to transform your HTTP request into the service's API call format.

For example, imagine you want to expose a simple endpoint that puts messages onto an SQS queue. With an HTTP API and a direct SQS integration, you configure parameter mapping to extract the message body from the request and map it to SQS's `SendMessage` action. No Lambda needed.

The trade-off is flexibility. Direct integrations work beautifully for straightforward operations—publish to SNS, write to DynamoDB, queue a message—but they can't handle complex business logic or cross-service orchestration. For those scenarios, Lambda remains the right tool.

### Performance and Cost Benefits

The performance advantage of native transformations is immediate. A mapping template in REST API or parameter mapping in HTTP API executes within the gateway's request path. There's no separate invocation, no startup latency, no cold start. For latency-sensitive applications, this matters. Median latency drops from tens of milliseconds (with Lambda) to single-digit milliseconds.

The cost benefit is equally compelling. Mapping templates and direct integrations are free. You pay for API Gateway requests, but not per transformation. Lambda, by contrast, charges per invocation. If your API handles thousands of requests per minute, even a simple transformation Lambda function can accumulate significant costs. A transformation-only Lambda might cost $20-50 per month depending on traffic, whereas the mapping template approach costs nothing additional.

Consider a real-world example: an API that reformats incoming requests and adds headers. At 100,000 requests per day with a Lambda function costing $0.0000002 per invocation, you're looking at roughly $6 per month just for transformations. Scale that to 1 million requests per day, and you're at $60 per month. That's money spent purely on format shifting, with no business logic. A mapping template eliminates that cost entirely.

### Building Your First Mapping Template

Let's walk through a practical example end-to-end. Suppose you're building an API that accepts product data from an e-commerce platform and needs to standardize it before sending to a backend service.

First, you'd create a REST API resource and method in the AWS Management Console. Under the method's integration, you'd select your backend (let's say an HTTP endpoint). Then, you'd access the "Method Execution" view and click "Integration Request."

In the Integration Request section, you'll find the "Mapping Templates" option. Click "Add mapping template" and specify the content type (usually `application/json`). This opens the VTL editor.

Here's a realistic mapping template that transforms incoming product data:

```
#set($timestamp = $util.formatDate("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", $util.timestampInMillis()))
{
  "id": "$util.escapeJavaScript($input.path('$.productId'))",
  "name": "$util.escapeJavaScript($input.path('$.title'))",
  "description": "$util.escapeJavaScript($input.path('$.description'))",
  "price": $input.path('$.priceUsd'),
  "currency": "USD",
  "ingestionTime": "$timestamp",
  "source": "$input.params('X-Source-System')",
  "metadata": {
    "category": "$input.path('$.category')",
    "sku": "$input.path('$.sku')",
    "inStock": #if($input.path('$.inventory') > 0) true #else false #end
  }
}
```

This template does several things: it extracts fields from the incoming JSON, adds a server-generated timestamp, reads a custom header (`X-Source-System`), performs a simple boolean transformation based on inventory, and escapes string values to prevent injection attacks. All of this happens before your backend ever sees the request.

### Error Handling in Mapping Templates

One aspect that often trips developers up is error handling. What happens if a required field is missing from the incoming request? VTL doesn't throw exceptions the way traditional code does—instead, missing values become empty strings or null, and the template continues.

To be defensive, you can use VTL's conditional logic to validate data:

```
#if($input.path('$.userId'))
{
  "userId": $input.path('$.userId'),
  "timestamp": $util.formatDate("iso8601", $util.timestampInMillis())
}
#else
{
  "error": "userId is required"
}
#end
```

However, if you need sophisticated validation—checking data types, enforcing complex business rules, or conditionally routing to different backends—you're approaching the boundary of what mapping templates handle gracefully. At that point, Lambda becomes more maintainable.

### Response Transformation Patterns

Response transformations deserve equal attention. Your backend might return verbose or unstructured data that clients don't expect. A response mapping template cleans this up.

Imagine your backend returns:

```json
{
  "statusCode": 200,
  "data": {
    "user": {
      "id": 12345,
      "profile": {
        "givenName": "Alice",
        "familyName": "Johnson"
      }
    },
    "requestId": "abc-123"
  }
}
```

But your API's contract specifies:

```json
{
  "id": 12345,
  "firstName": "Alice",
  "lastName": "Johnson"
}
```

Your response mapping template flattens and renames:

```
{
  "id": $input.path('$.data.user.id'),
  "firstName": "$input.path('$.data.user.profile.givenName')",
  "lastName": "$input.path('$.data.user.profile.familyName')"
}
```

This is especially powerful when you're aggregating multiple backend systems or adapting legacy APIs to modern interfaces.

### Knowing When to Reach for Lambda Instead

Mapping templates are powerful, but they have limits. Recognizing those limits prevents you from spending hours trying to force VTL to do something it wasn't designed for.

Lambda is the better choice when you need to query a database, call another API, perform complex calculations, or implement business logic. If your transformation depends on runtime data beyond what's in the current request or response, you need Lambda. If you're doing anything that feels like "real code"—branching on multiple conditions, looping with logic, calling external systems—Lambda is cleaner and more maintainable.

Another consideration is team expertise. VTL is specialized; most developers aren't familiar with it. If your team prefers writing Python, Node.js, or Go, a Lambda function might be more intuitive, even if it costs a bit more. Technical debt and maintainability matter.

There's also a practical limit to template complexity. A 500-line VTL template becomes unreadable. If you find your mapping template growing beyond 100-150 lines, consider whether a Lambda function would be clearer.

### Practical Optimization Strategies

To maximize the benefits of native transformations, keep a few strategies in mind.

**Cache your transformations when possible**. If you have multiple endpoints performing similar transformations, consolidate them or reference shared templates (REST API supports this through templates in the API stage).

**Use HTTP API for simple, high-throughput transformations**. HTTP APIs are roughly 30% faster than REST APIs and cheaper. If you only need parameter mapping, skip REST API entirely.

**Monitor gateway latency with CloudWatch**. API Gateway publishes metrics for latency, errors, and throughput. Watch for mapping template failures or unexpected slowdowns. If you see consistent high latency in the Integration Request phase, that might indicate your template is doing too much.

**Test templates locally when possible**. Most of your template development happens in the AWS Console, but you can use tools like the Serverless Framework or AWS SAM to version and test templates alongside your infrastructure code.

### Combining Transformations at Different Layers

In real applications, you'll often combine transformations across multiple layers. API Gateway handles basic reformatting, then a lightweight Lambda might do one business-logic check, then response transformation happens back in API Gateway. This layered approach keeps each component focused and fast.

For example: incoming request → gateway request mapping (extract fields) → Lambda (validate against database) → gateway response mapping (flatten response). Each layer does what it's best suited for.

### Conclusion

API Gateway's native transformation capabilities are a underutilized tool in many developers' toolkits. By using VTL mapping templates in REST APIs or parameter mapping in HTTP APIs, you can eliminate the cost and latency overhead of transformation-only Lambda functions. Common patterns like reformatting JSON, adding headers, extracting fields, and conditional logic all work elegantly without custom code.

The sweet spot is straightforward transformations: format shifting, field extraction, and simple conditional logic. When you need database queries, external API calls, or complex business logic, Lambda remains the right choice. The key is knowing where the line is and choosing the tool that balances performance, cost, and maintainability for your specific use case.

Start by auditing your APIs for transformation-only Lambda functions. Each one you replace with a mapping template reduces your bill, lowers latency, and eliminates a potential point of failure. Your users will appreciate the faster responses, and your cloud bill will thank you.
