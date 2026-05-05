---
title: "EventBridge API Destinations: Calling Third-Party SaaS APIs from Events"
---

## EventBridge API Destinations: Calling Third-Party SaaS APIs from Events

There's a moment in almost every cloud architect's career when they realize they need to push data from AWS events directly into a third-party service—maybe a Slack notification, a Salesforce record creation, or a custom webhook handler. The old approach meant spinning up Lambda functions to handle the HTTP calls, managing authentication, handling retries, and monitoring failures. EventBridge API Destinations simplify this significantly by letting you send events directly to external HTTP endpoints without writing any code.

This capability transforms how you think about event-driven architectures. Instead of treating AWS services as your only event targets, you can treat any HTTP endpoint as a first-class event destination. In this article, we'll explore how to set up and use EventBridge API Destinations, walk through the authentication mechanisms, and build a practical example that ties everything together.

### Understanding EventBridge API Destinations

API Destinations represent a specific target type within EventBridge that allows your rules to send events as HTTP requests to external endpoints. Think of them as a bridge between AWS event sources and the rest of the internet. When you create a rule that targets an API Destination, EventBridge will serialize your event, format it according to your specifications, and make an HTTP call to your endpoint.

The power here lies in abstraction. You don't need to manage the HTTP client library, implement authentication refresh logic, or write boilerplate code. EventBridge handles the plumbing. What you do need to manage is the connection definition, the destination endpoint, and how you transform your events into the format your external service expects.

Think of a typical workflow: an order is placed in your e-commerce system, an event is published to EventBridge, and you want to automatically create a corresponding record in your CRM system and notify your sales team via Slack. Without API Destinations, you'd write a Lambda function to do both. With API Destinations, you can route that single event to multiple HTTP endpoints through separate rules, each with its own transformation logic.

### The Architecture: Connections and Destinations

EventBridge API Destinations require two building blocks: a Connection and an API Destination. Let's clarify the distinction, because they're closely related but serve different purposes.

A **Connection** is where you store and manage your authentication credentials. This is the secure part—it holds your API keys, OAuth tokens, basic auth credentials, or other secrets that your external service requires. When you create a Connection, you specify the authentication method and provide the credentials. EventBridge stores these securely in AWS Secrets Manager (behind the scenes), so your credentials are never visible in event data or logs.

An **API Destination** is the configuration for the actual HTTP endpoint. It references a Connection to handle authentication, specifies the base URL of the external service, defines the HTTP method and rate limits, and handles retry and dead-letter queue behavior. Multiple API Destinations can share the same Connection if they're calling endpoints within the same external service.

Here's a concrete way to think about it: imagine you're integrating with Slack. You'd create one Connection that stores your Slack webhook authentication, then create one API Destination per channel or use case—one for order notifications, another for system alerts. Each API Destination points back to that same Connection but hits a different Slack webhook URL.

### Creating a Connection with Authentication

Let's start by setting up a Connection. AWS supports three authentication methods: Basic authentication, API Key authentication, and OAuth. Your choice depends on what the external service requires.

**Basic Authentication** is the simplest. You provide a username and password, which EventBridge will encode as Base64 and include in the Authorization header of every request. This works fine for internal APIs or services with less stringent security requirements, though for production SaaS integrations you'll rarely encounter this as the primary method.

To create a Connection with basic authentication using the AWS CLI, you'd do something like:

```bash
aws events create-connection \
  --name my-api-connection \
  --description "Connection to my third-party API" \
  --authorization-type BASIC \
  --auth-parameters "BasicAuthParameters={Username=myuser,Password=mypassword}"
```

**API Key Authentication** is more common in modern APIs. The external service provides an API key, and you send it as a custom header with each request. Here's how you'd create that Connection:

```bash
aws events create-connection \
  --name slack-webhook-connection \
  --description "Connection to Slack webhook" \
  --authorization-type API_KEY \
  --auth-parameters "ApiKeyAuthParameters={ApiKeyName=Authorization,ApiKeyValue=Bearer xoxb-your-slack-token}"
```

In this example, `ApiKeyName` specifies the header name (Authorization), and `ApiKeyValue` is the actual token. When EventBridge makes requests to your API Destination using this Connection, it will automatically include this header.

**OAuth 2.0** is the most sophisticated option and is commonly used by major SaaS platforms. When you use OAuth, you provide the client credentials and authorization endpoint details. EventBridge handles the OAuth flow—it will request access tokens and refresh them as needed. Here's an example:

```bash
aws events create-connection \
  --name salesforce-connection \
  --description "OAuth connection to Salesforce" \
  --authorization-type OAUTH_CLIENT_CREDENTIALS \
  --auth-parameters "OAuthParameters={ClientParameters={ClientID=your-client-id},AuthorizationEndpoint=https://login.salesforce.com/services/oauth2/authorize,HttpMethod=POST}"
```

With OAuth, EventBridge securely stores your client secret (which you'd typically pass through a separate parameter or stored in Secrets Manager), and it automatically obtains and manages access tokens. This is especially valuable for long-running integrations where token refresh would otherwise require your code to handle.

One important note: for all these methods, if you're using the AWS Management Console, it's straightforward—you fill in a form. If you're using the CLI or Infrastructure as Code tools, you need to be careful about how you pass sensitive values. The best practice is to use AWS Secrets Manager or environment variables rather than hardcoding credentials in your scripts.

### Defining the API Destination

Once your Connection exists, creating the API Destination is straightforward. This is where you specify the endpoint URL, HTTP method, rate limiting, and invocation behavior.

Let's create an API Destination that points to a Slack webhook:

```bash
aws events create-connection \
  --name slack-connection \
  --authorization-type API_KEY \
  --auth-parameters "ApiKeyAuthParameters={ApiKeyName=Authorization,ApiKeyValue=Bearer xoxb-xxxx}"

aws events put-api-destination \
  --name slack-orders-destination \
  --description "Slack webhook for order notifications" \
  --connection-arn arn:aws:events:us-east-1:123456789012:connection/slack-connection/xxxxx \
  --invocation-http-parameters \
    HeaderParameters="{Content-Type=application/json}" \
  --http-method POST \
  --invocation-rate-limit-per-second 10
```

Let's break down what's happening here. The `--http-method` specifies that we're making POST requests. The `--invocation-rate-limit-per-second` prevents overwhelming the external service—if you set this to 10, EventBridge will never send more than 10 requests per second to this destination.

The `--invocation-http-parameters` is particularly useful. You can set static headers that will be added to every request. In this case, we're ensuring the Content-Type header is set to application/json, which tells Slack what format to expect.

### Attaching API Destinations to Rules and Routing Events

Creating a rule and attaching an API Destination as a target is where everything comes together. Let's say you want to send all order-placed events to Slack:

```bash
aws events put-rule \
  --name order-notifications \
  --event-pattern '{"source":["myapp"],"detail-type":["Order Placed"]}' \
  --state ENABLED

aws events put-targets \
  --rule order-notifications \
  --targets "Id"="1",\
"Arn"="arn:aws:events:us-east-1:123456789012:api-destination/slack-orders-destination",\
"RoleArn"="arn:aws:iam::123456789012:role/EventBridgeApiDestinationRole",\
"HttpParameters"="{PathParameterValues=[],HeaderParameters={X-Custom-Header=value}}"
```

Notice the RoleArn parameter—this is important. EventBridge needs an IAM role with permissions to invoke the API Destination. The role needs a trust relationship with the EventBridge service, and it needs a policy allowing the `events:InvokeApiDestination` action. Here's what that policy looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "events:InvokeApiDestination",
      "Resource": "arn:aws:events:us-east-1:123456789012:api-destination/slack-orders-destination"
    }
  ]
}
```

Now, whenever an Order Placed event arrives from your application, EventBridge will match it against the rule, transform it according to your specifications (more on that shortly), and send it to the Slack webhook.

### Transforming Events with Input Transformers

Here's where flexibility comes in. Your EventBridge events are structured differently from what your external API expects. If you're sending an event to Slack, you probably don't want to send the raw event JSON—you want to craft a nicely formatted message with specific fields extracted.

EventBridge provides two mechanisms for transformation: InputTransformers and InputPathsMap. An InputTransformer lets you extract specific fields from your event and use them to construct a custom payload.

Let's say your Order Placed event looks like this:

```json
{
  "source": "myapp",
  "detail-type": "Order Placed",
  "detail": {
    "orderId": "ORD-12345",
    "customerId": "CUST-67890",
    "amount": 299.99,
    "customerEmail": "jane@example.com"
  }
}
```

But Slack expects a specific JSON structure. You'd use an InputTransformer:

```bash
aws events put-targets \
  --rule order-notifications \
  --targets "Id"="1",\
"Arn"="arn:aws:events:us-east-1:123456789012:api-destination/slack-orders-destination",\
"RoleArn"="arn:aws:iam::123456789012:role/EventBridgeApiDestinationRole",\
"InputTransformer"="{InputPathsMap={orderId='$.detail.orderId',amount='$.detail.amount',email='$.detail.customerEmail'},InputTemplate='{\"text\":\"New order <orderId> for $<amount> from <email>\"}'}"
```

The `InputPathsMap` extracts values from your event using JSONPath syntax. The `InputTemplate` is a JSON string where those extracted values are substituted. EventBridge will replace `<orderId>`, `<amount>`, and `<email>` with the actual values from your event.

For more complex transformations, you might use a JSON formatter. Here's a more sophisticated example that creates a properly formatted Slack message:

```bash
"InputTransformer"="{
  InputPathsMap={
    orderId='$.detail.orderId',
    amount='$.detail.amount',
    email='$.detail.customerEmail'
  },
  InputTemplate='{
    \"text\":\"New order received\",
    \"blocks\":[
      {
        \"type\":\"section\",
        \"text\":{\"type\":\"mrkdwn\",\"text\":\"*Order ID:* <orderId>\n*Amount:* $<amount>\n*Customer:* <email>\"}
      }
    ]
  }'
}"
```

This creates a rich, formatted Slack message with blocks that display nicely in the Slack UI.

### Handling Retries and Dead-Letter Queues

What happens when the external service is temporarily unavailable? By default, EventBridge will retry failed invocations with exponential backoff. You can customize this behavior when creating your API Destination or when attaching it as a target.

Let's attach an API Destination with explicit retry and dead-letter queue configuration:

```bash
aws events put-targets \
  --rule order-notifications \
  --targets "Id"="1",\
"Arn"="arn:aws:events:us-east-1:123456789012:api-destination/slack-orders-destination",\
"RoleArn"="arn:aws:iam::123456789012:role/EventBridgeApiDestinationRole",\
"RetryPolicy"="{MaximumEventAge=3600,MaximumRetryAttempts=2}",\
"DeadLetterConfig"="{Arn=arn:aws:sqs:us-east-1:123456789012:api-destination-dlq}"
```

The `RetryPolicy` specifies that events older than 3600 seconds (1 hour) won't be retried, and we'll attempt delivery a maximum of 2 times before giving up. The `DeadLetterConfig` points to an SQS queue where failed invocations will be sent for later analysis or manual intervention.

This is critical for production systems. Without a dead-letter queue, events that fail after all retries are simply dropped—you'll have no way of knowing what failed. With a DLQ, you can investigate failures, replay events once you've fixed the external service, or send alerts to your operations team.

### A Practical End-to-End Example

Let's tie everything together with a complete example: routing AWS events to a CRM system. Imagine you have a customer registration event from your application, and you want to automatically create a contact in HubSpot.

First, create the Connection for HubSpot. HubSpot uses API Key authentication:

```bash
aws events create-connection \
  --name hubspot-connection \
  --description "Connection to HubSpot CRM" \
  --authorization-type API_KEY \
  --auth-parameters "ApiKeyAuthParameters={ApiKeyName=Authorization,ApiKeyValue=Bearer your-hubspot-api-key}"
```

Next, create the API Destination pointing to HubSpot's contact creation endpoint:

```bash
aws events put-api-destination \
  --name hubspot-contacts-destination \
  --description "HubSpot API for creating contacts" \
  --connection-arn arn:aws:events:us-east-1:123456789012:connection/hubspot-connection/xxxxx \
  --invocation-http-parameters \
    HeaderParameters="{Content-Type=application/json}" \
  --http-method POST \
  --invocation-rate-limit-per-second 50
```

Create an EventBridge rule to match customer registration events:

```bash
aws events put-rule \
  --name customer-registration \
  --event-pattern '{"source":["myapp"],"detail-type":["Customer Registered"]}' \
  --state ENABLED
```

Finally, attach the API Destination as a target with a transformation that shapes the event into HubSpot's expected format:

```bash
aws events put-targets \
  --rule customer-registration \
  --targets "Id"="1",\
"Arn"="arn:aws:events:us-east-1:123456789012:api-destination/hubspot-contacts-destination",\
"RoleArn"="arn:aws:iam::123456789012:role/EventBridgeApiDestinationRole",\
"InputTransformer"="{
  InputPathsMap={
    firstName='$.detail.firstName',
    lastName='$.detail.lastName',
    email='$.detail.email',
    phone='$.detail.phone'
  },
  InputTemplate='{
    \"firstname\":\"<firstName>\",
    \"lastname\":\"<lastName>\",
    \"email\":\"<email>\",
    \"phone\":\"<phone>\"
  }'
}",\
"RetryPolicy"="{MaximumEventAge=86400,MaximumRetryAttempts=3}",\
"DeadLetterConfig"="{Arn=arn:aws:sqs:us-east-1:123456789012:crm-integration-dlq}"
```

Now, whenever a customer registers in your system, EventBridge automatically creates a matching contact in HubSpot. If HubSpot is temporarily unavailable, EventBridge retries up to 3 times over the course of a day. If all retries fail, the event goes to your dead-letter queue for analysis.

### Rate Limiting and Throttling Considerations

When integrating with external services, rate limits are a fact of life. Most SaaS APIs enforce per-second or per-minute request limits to prevent abuse and ensure fair resource allocation. EventBridge lets you configure invocation rate limits at the API Destination level.

The `--invocation-rate-limit-per-second` parameter controls how many requests EventBridge will send per second. If you set it to 10 and your application generates 50 events per second that match your rule, EventBridge will queue those events and invoke the destination at most 10 times per second, with the remaining events being processed more slowly.

This differs from retry behavior—rate limiting is about controlling the pace of new invocations, while retries handle failures. You need both. Set your rate limit based on what the external service's documentation tells you. Most modern APIs support at least 10-100 requests per second, but always verify with the service you're integrating with.

### Monitoring and Troubleshooting

EventBridge sends metrics to CloudWatch, and you can create alarms to monitor your API Destination invocations. Key metrics include Invocations (successful calls), FailedInvocations (calls that failed after all retries), and ThrottledRules (calls prevented due to rate limiting).

If you see a spike in FailedInvocations, check your dead-letter queue to understand what went wrong. Common issues include authentication failures (check that your Connection credentials are still valid), network connectivity problems, or the external service rejecting your event format.

For authentication issues, especially with OAuth, remember that EventBridge automatically refreshes tokens behind the scenes. If the OAuth provider is returning errors, you'll see invocation failures. Check the Connection's authentication settings and verify that the OAuth credentials in Secrets Manager haven't been rotated or revoked.

For format issues, manually test your transformation by constructing a sample event and running it through your InputTransformer logic. EventBridge provides a test event feature in the console that can help you verify your transformations before deploying to production.

### Security Best Practices

When working with API Destinations, security deserves careful attention. Your credentials are stored in Secrets Manager, but they're still accessible to any process or principal that has IAM permissions to invoke the API Destination. Follow the principle of least privilege: grant only the specific IAM role you're using for EventBridge rules the permissions it needs, nothing more.

Avoid putting API keys or tokens directly in your event data. Use InputTransformers to extract only the necessary fields, and let the Connection handle authentication separately. This ensures that sensitive information never appears in your event stream or logs.

Use HTTPS for all external endpoints. EventBridge will only connect to HTTP endpoints if you explicitly configure them, but you should never do so in production. HTTPS encrypts the credentials in transit and protects your event data from interception.

If you're rotating API keys for external services, update the Connection and all dependent API Destinations without needing to redeploy EventBridge rules. The decoupling of Connection from API Destination is intentional—it gives you flexibility to update credentials without affecting your routing rules.

### Limitations and When to Use Alternatives

API Destinations are powerful, but they're not the solution for every integration scenario. If you need complex business logic, transformations that depend on external data, or conditional routing based on runtime variables, a Lambda function might be more appropriate. Lambda offers full programmability at the cost of additional operational complexity.

API Destinations also support only HTTP/HTTPS endpoints. If you need to call a gRPC service, connect to a raw TCP socket, or use a protocol other than HTTP, you'll need a Lambda function or another integration pattern.

The invocation payload size is limited to a few megabytes, which is rarely an issue for typical event data but could constrain you if you're trying to send large payloads. InputTransformers also have limitations on complexity—for elaborate transformations, Lambda is more suitable.

That said, for straightforward HTTP integrations with SaaS platforms, webhooks, and REST APIs, API Destinations are ideal. They reduce boilerplate, simplify operational overhead, and let you focus on your business logic rather than infrastructure.

### Conclusion

EventBridge API Destinations democratize event-driven integration with external systems. By abstracting away authentication, HTTP client management, and retry logic, they let you build hybrid architectures that span AWS and the wider SaaS ecosystem without writing Lambda functions for every integration point.

The pattern is straightforward: create a Connection to manage credentials, define an API Destination to specify the endpoint and rate limits, create a rule to match events, and attach the destination as a target with appropriate transformations. From there, EventBridge handles the rest—authentication, retries, rate limiting, and dead-letter queue management.

Start with a simple integration like a Slack notification webhook to get comfortable with the concepts, then expand to more complex SaaS platforms as you need them. Use dead-letter queues from day one to catch failures, monitor your invocations with CloudWatch metrics, and always test your InputTransformers thoroughly before deploying to production. With these patterns in place, you'll build integrations that are reliable, maintainable, and scalable.
