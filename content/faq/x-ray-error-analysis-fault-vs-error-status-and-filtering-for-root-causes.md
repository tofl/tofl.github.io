---
title: "X-Ray Error Analysis: Fault vs Error Status and Filtering for Root Causes"
---

## X-Ray Error Analysis: Fault vs Error Status and Filtering for Root Causes

When something goes wrong in your distributed application, you need to know—fast—whether the problem lives on your side or the client's. AWS X-Ray gives you that visibility, but only if you understand how it categorizes and displays failures. The distinction between a fault and an error might seem semantic, but it's fundamental to effective troubleshooting. Misinterpreting these signals can send you down a rabbit hole debugging client-side issues or, worse, missing a critical server problem hiding in your logs.

This article walks you through how X-Ray interprets HTTP status codes, tracks errors and faults through the lifecycle of a request, and gives you the tools to filter and diagnose root causes with confidence. We'll examine real-world scenarios—invalid user input, upstream timeouts, throttling—and show exactly how each manifests in your traces.

### Understanding the Fault vs Error Distinction

X-Ray uses two primary status markers to classify problems: **fault** and **error**. These map directly to HTTP status code ranges, and understanding the difference is the key to reading your traces correctly.

A **fault** indicates that something went wrong on the server side. This is your responsibility to fix. Faults correspond to HTTP 5xx status codes—500 Internal Server Error, 502 Bad Gateway, 503 Service Unavailable, and so on. When X-Ray sees a 5xx status, it marks the segment or subsegment as faulted. This signals that your application, your dependency, or the AWS service itself encountered an issue that prevented the request from completing successfully.

An **error**, by contrast, means the client made a bad request. HTTP 4xx status codes—400 Bad Request, 404 Not Found, 401 Unauthorized—indicate that the client provided invalid data, referenced a nonexistent resource, or lacked proper authentication. When X-Ray sees a 4xx response, it marks the segment as errored. The client bears responsibility for correcting their request.

This distinction matters because it immediately tells you where to focus your investigation. A fault means something in your infrastructure needs attention. An error means your API contract was violated, and the client needs to fix their request. Neither is good, but the remediation path is entirely different.

There's also a third status: **throttle**, which deserves special mention. When a service or resource reaches its limit and rejects a request with a 429 Too Many Requests status, X-Ray marks it as throttled. This is technically a 4xx, but it's distinct enough to warrant its own filtering category, because throttling often points to capacity planning or rate limiting configuration rather than application bugs.

### How Segments and Subsegments Handle Status

X-Ray organizes request flows into a hierarchy. The root segment represents the overall request—typically the API endpoint or Lambda invocation. Within that, subsegments represent calls to downstream services: database queries, external APIs, other Lambda functions, or AWS services.

Each segment and subsegment has its own status field. The rules for how these statuses work together are important: a subsegment's status doesn't automatically propagate upward, nor does it override the parent segment's status. Instead, the root segment's status is determined by whether the overall request succeeded or failed. However, the presence of any faulted subsegment often indicates a cascading failure that affected the final result.

Consider a Lambda function that calls DynamoDB. If the Lambda itself returns a 200 OK but the DynamoDB call was throttled, the subsegment for that DynamoDB call will have `throttle: true`, but the root segment might still show a successful status—because the Lambda handled the throttling gracefully and returned a valid response. Conversely, if that DynamoDB call failed and the Lambda didn't handle the exception, the root segment will be marked as faulted because the Lambda ultimately returned a 5xx status.

This layered approach lets you drill down into exactly where a failure occurred. You might have a successful root segment with a faulted subsegment, which tells you that your primary function recovered from an issue with a dependency. Or you might have a faulted root segment with multiple faulted subsegments, indicating a cascade of failures.

### The Error Field and Exception Details

Within each segment or subsegment, X-Ray stores an `error` field that can be set to `true` if the segment represents a 4xx response. Similarly, a `fault` field is set to `true` for 5xx responses. These boolean flags are the primary way X-Ray categorizes the request.

But X-Ray also captures the `exception` details. When your application throws an uncaught exception, X-Ray records it with the exception's name, message, and stack trace. This is invaluable for understanding not just *that* something failed, but *why* it failed. An exception tells you the specific error condition your code encountered, while the fault flag tells you it resulted in a server-side failure.

Here's the distinction in practice: a 400 Bad Request might have an `error: true` flag and no exception, because the application explicitly validated the input and returned a standard response. By contrast, a 500 Internal Server Error might have a `fault: true` flag *and* an exception capturing a NullPointerException or database connection timeout. The exception gives you the actionable details.

### Practical Scenario: 400 Bad Request from Invalid Input

Let's walk through a concrete example. You have a Lambda function that accepts a JSON payload with a user's age. Your code checks that the age is between 0 and 150. When a client sends age as -5, your function catches the validation error and returns a 400 Bad Request with a descriptive error message.

In X-Ray, this trace will show:

- Root segment with `error: true` and `fault: false`
- HTTP status code 400
- No uncaught exception recorded
- The response includes your custom error message, e.g., "Invalid age: must be between 0 and 150"

The client sees a 400 and understands they need to correct their request. You see the error in X-Ray, understand it's a client-side issue, and perhaps track it for API usage analytics, but you don't page an on-call engineer. The error flag tells you this is expected behavior—bad input happens, and your service handled it correctly.

### Practical Scenario: 502 Bad Gateway from Timeout

Now consider a different failure. Your Lambda function calls an external payment processing API with a generous 10-second timeout. The API is slow today due to a deployment gone wrong on their end. Your function waits the full 10 seconds, times out, and throws an exception that it doesn't catch. The Lambda runtime returns a 502 Bad Gateway to the client.

In X-Ray, the trace looks different:

- Root segment with `error: false` and `fault: true`
- HTTP status code 502
- An exception is recorded: `ConnectTimeoutException` with a message indicating the timeout
- The subsegment for the external API call shows `fault: true` and includes the timeout exception

This fault flag tells you something went wrong on the server side. The external API was slow or unavailable. You might need to investigate their status page, adjust your timeout, implement retry logic, or add circuit breaker patterns. The exception details pinpoint the exact failure mode.

### Practical Scenario: 429 Throttle Response

Consider a third scenario. Your Lambda invokes DynamoDB, but you've set a low provisioned throughput for testing, and the current request volume exceeds capacity. DynamoDB returns a 429 Too Many Requests.

In X-Ray, the subsegment for the DynamoDB call will show:

- `throttle: true` is set
- HTTP status code 429
- No fault flag (this is often debated in AWS documentation, but conventionally 429 is neither error nor fault from the client's perspective—it's capacity-based)
- The subsegment might include throttle-specific metadata

If your Lambda catches this 429 and implements exponential backoff to retry, the root segment might still show a 200 OK. But the subsegment tells the story: you hit throttling. This signals you to revisit your capacity planning or request rate rather than debugging application logic.

### Reading X-Ray Traces with Error Context

When you open X-Ray in the AWS Management Console or query it via the API, you'll see trace summaries and detailed timelines. The summary view shows you the HTTP status code and whether the trace contains errors or faults—often with a color-coded indicator (green for success, red for fault, yellow or orange for error). This quick visual tells you the severity at a glance.

The detailed trace view breaks down each segment and subsegment. For each one, you can see:

- The operation name (e.g., "DynamoDB GetItem", "Lambda Invoke")
- Start time and duration
- HTTP status code (if applicable)
- Boolean flags: `error`, `fault`, `throttle`
- Exception details, if present
- Custom annotations and metadata you've added via X-Ray SDKs

Pay attention to the exception details. They often contain the most actionable information. A stack trace tells you exactly where in your code the failure originated. A database connection error message tells you to check your credentials and network configuration. A message about a missing environment variable tells you where to look in your Lambda configuration.

### Filtering Traces by Status

X-Ray's query language and filter capabilities let you slice your traces by status, helping you zero in on the problems that matter. You can filter for traces with `fault: true` to see only server-side failures. This is useful for incident response—you want to know if your service is failing its own responsibility to handle requests.

Filtering for `error: true` shows you client-side issues. If error volume is spiking, it might indicate a client library bug, a misconfigured API client, or a change in how clients are consuming your API.

Filtering for `throttle: true` highlights capacity constraints. If you see a steady stream of throttled requests, it's time to scale.

In practice, you might construct a filter like `http.status >= 500` to find all server-side failures, or `http.status >= 400 AND http.status < 500` to find client errors. X-Ray also supports filtering on response time, annotation values, and exception types, giving you fine-grained control over which traces you examine.

### Building Observability into Your Code

To get the most out of X-Ray's error categorization, you should explicitly set status codes and capture exceptions. In a Lambda function using the X-Ray SDK, you can wrap your handlers and subsegment calls:

```python
from aws_xray_sdk.core import xray_recorder
from aws_xray_sdk.core import patch_all

patch_all()

@xray_recorder.capture('process_user_data')
def process_user_data(user_data):
    if not user_data.get('age'):
        raise ValueError('Age is required')
    
    age = int(user_data['age'])
    if age < 0 or age > 150:
        raise ValueError(f'Invalid age: {age}')
    
    return {'success': True, 'age': age}

def lambda_handler(event, context):
    try:
        result = process_user_data(event)
        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }
    except ValueError as e:
        return {
            'statusCode': 400,
            'body': json.dumps({'error': str(e)})
        }
    except Exception as e:
        # Log the exception; X-Ray will capture it
        print(f'Unexpected error: {e}')
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Internal server error'})
        }
```

The key here is that by catching and handling `ValueError` (validation errors), you return a 400, which X-Ray marks as an error. Uncaught exceptions trigger a 500, which X-Ray marks as a fault. This categorization happens automatically when you return the appropriate status code, but the SDK also respects explicit calls to mark a segment as errored or faulted if you prefer programmatic control.

### Interpreting Cascading Failures

Real-world failures often cascade. Your Lambda calls Service A, which calls Service B, which hits a timeout. X-Ray's hierarchical view shines here. You'll see the root segment with a fault, and by navigating the tree, you'll find the specific subsegment where the timeout occurred. This eliminates guesswork—you're looking at the actual failure point, not a symptom several layers up the stack.

Conversely, you might see a faulted subsegment but a successful root segment. This happens when your code gracefully degrades. A cache miss on Redis shouldn't cause your API to fail; it should fetch from the database instead. In X-Ray, the Redis subsegment might show a timeout fault, but your root segment shows a 200 OK because you handled it. This is a sign your error handling is working as intended.

### Common Pitfalls and Best Practices

One common mistake is confusing HTTP status codes with X-Ray status flags. A 502 Bad Gateway isn't an error—it's a fault. An error in X-Ray means a 4xx status, not an exception. Being precise about terminology saves confusion when discussing issues with teammates.

Another pitfall is ignoring throttling. Because 429 is technically a 4xx, some developers treat it like a client error and ignore it. But throttling is a capacity issue on your side. Monitor it separately and take it seriously as a scaling indicator.

Finally, remember that status flags are determined by HTTP status codes. If your application catches an exception but still returns a 500, X-Ray will mark it as faulted. Conversely, if you explicitly return a 400 for validation failures (even with an exception in the logs), X-Ray will mark it as errored. Be intentional about your status codes; they're how X-Ray understands your application's health.

### Conclusion

X-Ray's distinction between fault and error is deceptively simple but profoundly useful. Faults indicate server-side problems—your code, your infrastructure, or a dependency failed. Errors indicate client-side problems—bad requests that need correction on the client end. Throttling is its own category, pointing to capacity constraints. By understanding these categories, reading the exception details, and filtering traces strategically, you transform X-Ray from a logging tool into a precision diagnostic instrument. The next time an alert fires or a customer reports an issue, you'll know exactly where to look and what to fix.
