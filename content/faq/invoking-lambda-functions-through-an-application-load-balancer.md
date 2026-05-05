---
title: "Invoking Lambda Functions Through an Application Load Balancer"
---

# Invoking Lambda Functions Through an Application Load Balancer

If you've been building serverless applications on AWS, you've probably used API Gateway to expose your Lambda functions over HTTP. But there's another path that many developers overlook: using an Application Load Balancer (ALB) to invoke Lambda directly. This approach offers different trade-offs in cost, features, and operational simplicity, and understanding when to use it is crucial for making informed architectural decisions.

In this article, we'll explore how to integrate Lambda with an ALB, demystify the event format ALB sends to your functions, and walk through the practical considerations that determine whether ALB or API Gateway is the right choice for your use case.

### Understanding Lambda as an ALB Target

An Application Load Balancer operates at Layer 7 (the application layer), distributing traffic based on hostnames, paths, and other HTTP characteristics. Traditionally, ALBs route traffic to EC2 instances, on-premises servers, or containers running in ECS. What many developers don't realize is that Lambda functions can be registered as direct targets of an ALB, effectively turning the load balancer into an HTTP trigger for serverless compute.

Think of it this way: instead of sending requests to an API Gateway endpoint that then invokes Lambda, you can send requests directly to an ALB, which immediately forwards them to a Lambda function. The ALB handles the HTTP layer entirely — routing, load distribution, SSL/TLS termination, and all the standard load balancing features — while Lambda executes your business logic.

This is particularly valuable when you already have infrastructure built around ALBs, or when you're migrating traditional HTTP applications to a serverless model and want to maintain your existing load balancing layer.

### Creating a Lambda Target Group

To register Lambda as an ALB target, you first need to create a target group specifically for Lambda. This is where ALB configuration diverges from its use with EC2 or container targets.

When you create a new target group in the AWS console or via the CLI, you'll specify the target type as "Lambda function" rather than "instance" or "ip". Here's what that looks like with the AWS CLI:

```bash
aws elbv2 create-target-group \
  --name my-lambda-targets \
  --protocol HTTP \
  --target-type lambda
```

Notice that with Lambda target groups, the protocol is always HTTP and you don't specify a port — Lambda doesn't listen on a port in the traditional sense. The ALB invokes the function directly via the Lambda API.

Once created, you register specific Lambda functions to this target group:

```bash
aws elbv2 register-targets \
  --target-group-arn arn:aws:elasticloadbalancing:region:account-id:targetgroup/my-lambda-targets/abc123 \
  --targets Id=arn:aws:lambda:region:account-id:function:my-function
```

After registration, you create a listener on your ALB (typically on port 80 or 443) and attach it to this Lambda target group. Now, when traffic arrives at the ALB, it's routed to your Lambda function.

### The ALB Lambda Event Format

This is where understanding becomes critical. When ALB invokes your Lambda function, it doesn't send a simple HTTP request object. Instead, it serializes the request into a JSON event that follows a specific structure. If you've built Lambda functions before, you know this format intimately if you've used API Gateway, but ALB's format has important differences.

Here's a typical ALB event:

```json
{
  "requestContext": {
    "elb": {
      "targetGroupArn": "arn:aws:elasticloadbalancing:region:account-id:targetgroup/my-targets/abc123"
    }
  },
  "httpMethod": "GET",
  "path": "/api/users/42",
  "queryStringParameters": {
    "filter": "active",
    "sort": "name"
  },
  "headers": {
    "host": "my-alb.elb.amazonaws.com",
    "user-agent": "curl/7.64.1",
    "accept": "*/*"
  },
  "body": null,
  "isBase64Encoded": false
}
```

The structure should look familiar if you've used API Gateway, which is intentional — AWS designed the ALB event format to be compatible with API Gateway events to ease migration. The key fields are `httpMethod`, `path`, `queryStringParameters`, and `headers`.

For a POST request with a JSON body, the event might look like this:

```json
{
  "requestContext": {
    "elb": {
      "targetGroupArn": "arn:aws:elasticloadbalancing:region:account-id:targetgroup/my-targets/abc123"
    }
  },
  "httpMethod": "POST",
  "path": "/api/users",
  "headers": {
    "content-type": "application/json",
    "host": "my-alb.elb.amazonaws.com"
  },
  "body": "{\"name\": \"Alice\", \"email\": \"alice@example.com\"}",
  "isBase64Encoded": false
}
```

Notice that the `body` arrives as a string. If you're processing JSON, you'll need to parse it: `const data = JSON.parse(event.body)` in Node.js, or `json.loads(event['body'])` in Python.

Your Lambda function must return a response in a format that ALB understands. The response format is also JSON:

```json
{
  "statusCode": 200,
  "statusDescription": "200 OK",
  "headers": {
    "content-type": "application/json"
  },
  "body": "{\"id\": 42, \"name\": \"Alice\"}",
  "isBase64Encoded": false
}
```

The `statusCode` field tells ALB what HTTP status code to return to the client. If you're returning binary data like an image, you'd set `isBase64Encoded` to true and base64-encode the body. Here's a practical example of a Lambda handler that works with ALB events:

```javascript
exports.handler = async (event) => {
  console.log('ALB Event:', JSON.stringify(event));
  
  try {
    const method = event.httpMethod;
    const path = event.path;
    
    if (method === 'GET' && path === '/health') {
      return {
        statusCode: 200,
        statusDescription: '200 OK',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'healthy' }),
        isBase64Encoded: false
      };
    }
    
    if (method === 'POST' && path === '/api/users') {
      const user = JSON.parse(event.body);
      // Process user creation logic
      return {
        statusCode: 201,
        statusDescription: '201 Created',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 123, ...user }),
        isBase64Encoded: false
      };
    }
    
    return {
      statusCode: 404,
      statusDescription: '404 Not Found',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Not Found' }),
      isBase64Encoded: false
    };
  } catch (error) {
    return {
      statusCode: 500,
      statusDescription: '500 Internal Server Error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: error.message }),
      isBase64Encoded: false
    };
  }
};
```

### Handling Multi-Value Headers and Query Strings

One aspect of ALB events that trips up developers is how multiple values for the same header or query parameter are handled. If a client sends multiple values for the same query parameter — say, `?color=red&color=blue` — ALB provides them in a specific way.

In the ALB event, multi-value query parameters appear in a separate field: `multiValueQueryStringParameters`. Similarly, multi-value headers go in `multiValueHeaders`. Here's an example:

```json
{
  "queryStringParameters": {
    "color": "blue"
  },
  "multiValueQueryStringParameters": {
    "color": ["red", "blue"]
  },
  "headers": {
    "accept": "application/json"
  },
  "multiValueHeaders": {
    "accept": ["application/json", "text/html"]
  }
}
```

Notice that `queryStringParameters` contains only the last value, while `multiValueQueryStringParameters` contains all of them as an array. The same pattern applies to headers. When returning a response, if you need to set multiple values for a header, use `multiValueHeaders` in the response:

```javascript
return {
  statusCode: 200,
  statusDescription: '200 OK',
  headers: {
    'content-type': 'application/json'
  },
  multiValueHeaders: {
    'set-cookie': ['session=abc123; Path=/', 'tracking=xyz789; Path=/']
  },
  body: JSON.stringify({ message: 'success' }),
  isBase64Encoded: false
};
```

### Resource-Based Permissions for ALB Invocation

For ALB to invoke your Lambda function, the function needs the appropriate permissions. Unlike API Gateway, which uses a different invocation model, ALB invokes Lambda using the standard `lambda:InvokeFunction` permission. You grant this permission using a resource-based policy on your Lambda function.

When you register a Lambda function as an ALB target through the console, AWS automatically adds the necessary permission. However, if you're managing this through Infrastructure as Code or the CLI, you'll need to add it manually:

```bash
aws lambda add-permission \
  --function-name my-function \
  --principal elasticloadbalancing.amazonaws.com \
  --action lambda:InvokeFunction \
  --statement-id AllowALBInvocation
```

The principal `elasticloadbalancing.amazonaws.com` grants permission to the ALB service. If you want to restrict it further to a specific target group ARN, you can use a condition:

```bash
aws lambda add-permission \
  --function-name my-function \
  --principal elasticloadbalancing.amazonaws.com \
  --action lambda:InvokeFunction \
  --statement-id AllowSpecificALB \
  --source-arn arn:aws:elasticloadbalancing:region:account-id:targetgroup/my-targets/abc123
```

With Infrastructure as Code (Terraform, CloudFormation, SAM), this typically looks like an `aws_lambda_permission` resource or an AWS::Lambda::Permission in CloudFormation.

### Payload Size and Timeout Constraints

ALB has specific limitations when invoking Lambda that you must account for in your design. The most significant is the 1 MB payload limit. This applies to both the request body sent to Lambda and the response body returned from Lambda. If your function needs to process or return larger payloads, ALB is not the right choice — you'd need API Gateway or direct S3 integration.

This 1 MB limit is substantially smaller than many HTTP frameworks typically handle. If your API frequently deals with large files or verbose JSON responses, plan accordingly. You might need to implement pagination for list endpoints or stream large responses to S3 and return download links instead.

Another critical constraint is the timeout. ALB has a default idle timeout of 60 seconds. Since Lambda functions can run for up to 15 minutes (900 seconds), there's a potential mismatch. If your Lambda function takes more than 60 seconds to complete, the ALB will close the connection and return a timeout error to the client, even if your function completes later and tries to return a response.

For most web APIs, this 60-second timeout is acceptable. However, if you're building batch processing endpoints or long-running operations, you should consider an async pattern: accept the request in Lambda, start the long-running operation asynchronously (perhaps using Step Functions or SQS), and return a 202 Accepted status immediately. The client can then poll for completion or you can use webhooks to notify them.

You can adjust the ALB idle timeout if needed:

```bash
aws elbv2 modify-load-balancer-attributes \
  --load-balancer-arn arn:aws:elasticloadbalancing:region:account-id:loadbalancer/app/my-alb/abc123 \
  --attributes Key=idle_timeout.connection.s3.enabled,Value=true Key=idle_timeout.connection.s3.deregistration_delay.timeout_seconds,Value=120
```

However, the maximum you can extend this to is 4,000 seconds (approximately 67 minutes), so for truly long-running operations, an asynchronous pattern is essential.

### ALB vs. API Gateway: A Practical Comparison

Now that you understand how to use ALB with Lambda, the natural question is: should I use ALB or API Gateway? Both invoke Lambda over HTTP, but they have different characteristics.

**Cost is often the first consideration.** ALB charges based on capacity units — roughly $0.006 per LCU (load balancer capacity unit) per hour in the us-east-1 region. If you're running an ALB 24/7, that's about $43 per month just for the load balancer itself, plus data processing charges. API Gateway, by contrast, charges per million API calls: approximately $3.50 per million requests. For low-traffic applications, API Gateway is cheaper. For high-traffic applications where you already have an ALB running for other purposes, Lambda targets on that ALB add minimal cost.

**Feature coverage differs significantly.** API Gateway offers request/response transformation, request validation, authentication and authorization through request validators and authorizers, request throttling and rate limiting, API key management, and extensive monitoring through CloudWatch. ALB offers health checks, host and path-based routing, request tracing, and direct connection logging. If you need fine-grained authorization or request transformation, API Gateway's authorizers and mapping templates give you more built-in flexibility.

**Integration with other services** is another differentiator. API Gateway integrates tightly with services like Cognito for user authentication, can integrate with Lambda, HTTP endpoints, and AWS services directly without needing Lambda, and supports WebSocket APIs for real-time communication. ALB doesn't provide authorizers or specialized authentication integration — you'd handle that entirely within your Lambda function.

**Development and debugging** can be simpler with API Gateway. The AWS console provides a built-in test feature, and the generated SDKs can be useful for client libraries. ALB requires you to test Lambda functions through their own console or through actual HTTP requests to the load balancer.

**Latency characteristics** are slightly different. API Gateway adds a small overhead due to its additional request processing, while ALB typically has lower latency since it's simply forwarding to Lambda. However, for most applications, this difference is negligible.

Here's a practical decision framework:

Use ALB with Lambda if you already have an ALB for other services, your application has simple HTTP routing needs, you're not using API Gateway authorizers or request validation, and you want to minimize additional infrastructure. This is common in scenarios where you're migrating a traditional load-balanced application to serverless or where you're extending an existing ALB with new Lambda-based services.

Use API Gateway if you need strong security features like authorizers, your API will be public-facing and benefits from the managed authentication options, you want fine-grained control over request/response formatting, or you're building an API that doesn't already need a load balancer for other services.

For those building microservices, API Gateway has another advantage: it can be deployed independently per service, whereas ALB is typically centralized infrastructure. This impacts team ownership and deployment velocity in larger organizations.

### Practical Implementation Walkthrough

Let's walk through a complete example of setting up an ALB to invoke a Lambda function. Imagine we're building a simple URL shortener service.

First, we'll create the Lambda function:

```javascript
// url-shortener.js
const crypto = require('crypto');

const shortUrls = new Map(); // In production, use DynamoDB

exports.handler = async (event) => {
  const method = event.httpMethod;
  const path = event.path;

  try {
    if (method === 'POST' && path === '/shorten') {
      const { longUrl } = JSON.parse(event.body || '{}');
      
      if (!longUrl) {
        return {
          statusCode: 400,
          statusDescription: '400 Bad Request',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'longUrl is required' }),
          isBase64Encoded: false
        };
      }

      const shortCode = crypto.randomBytes(4).toString('hex');
      shortUrls.set(shortCode, longUrl);

      return {
        statusCode: 201,
        statusDescription: '201 Created',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ 
          shortCode, 
          shortUrl: `https://short.example.com/${shortCode}`,
          longUrl 
        }),
        isBase64Encoded: false
      };
    }

    if (method === 'GET' && path.startsWith('/')) {
      const shortCode = path.substring(1);
      const longUrl = shortUrls.get(shortCode);

      if (!longUrl) {
        return {
          statusCode: 404,
          statusDescription: '404 Not Found',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ error: 'Short URL not found' }),
          isBase64Encoded: false
        };
      }

      return {
        statusCode: 301,
        statusDescription: '301 Moved Permanently',
        headers: { 'location': longUrl },
        body: '',
        isBase64Encoded: false
      };
    }

    return {
      statusCode: 405,
      statusDescription: '405 Method Not Allowed',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
      isBase64Encoded: false
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      statusDescription: '500 Internal Server Error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Internal server error' }),
      isBase64Encoded: false
    };
  }
};
```

Next, we create the target group and register the Lambda function:

```bash
# Create the target group
aws elbv2 create-target-group \
  --name url-shortener-targets \
  --protocol HTTP \
  --target-type lambda

# Register the Lambda function (replace with your actual ARN)
aws elbv2 register-targets \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/url-shortener-targets/abc123 \
  --targets Id=arn:aws:lambda:us-east-1:123456789012:function:url-shortener
```

Then, grant the ALB permission to invoke the function:

```bash
aws lambda add-permission \
  --function-name url-shortener \
  --principal elasticloadbalancing.amazonaws.com \
  --action lambda:InvokeFunction \
  --statement-id AllowALBInvocation
```

Finally, create a listener on your ALB pointing to this target group:

```bash
aws elbv2 create-listener \
  --load-balancer-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-alb/abc123 \
  --protocol HTTP \
  --port 80 \
  --default-actions Type=forward,TargetGroupArn=arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/url-shortener-targets/abc123
```

Now your service is live. Test it:

```bash
# Shorten a URL
curl -X POST http://my-alb.elb.amazonaws.com/shorten \
  -H "Content-Type: application/json" \
  -d '{"longUrl": "https://example.com/very/long/path"}'

# Redirect to the long URL
curl -L http://my-alb.elb.amazonaws.com/abc123
```

### Monitoring and Troubleshooting

When using ALB with Lambda, monitoring presents a slightly different picture than with API Gateway. ALB metrics and Lambda metrics come from different sources, so you need to watch both.

For ALB, CloudWatch metrics like `TargetResponseTime`, `RequestCount`, and `TargetConnectionErrorCount` show you how the load balancer is performing. High `UnHealthyHostCount` metrics indicate that ALB health checks are failing, which typically happens when Lambda function responses aren't returning the expected format or are timing out.

For Lambda, monitor `Invocations`, `Duration`, `Errors`, and `Throttles`. The `Duration` metric is particularly important given the 60-second ALB timeout. If your function is consistently close to that limit, you'll see connection timeouts from ALB's perspective even though Lambda completes.

ALB performs health checks on Lambda targets by invoking the function with a special synthetic request. By default, it checks every 30 seconds. If your Lambda function is cold and takes more than the configured health check timeout to execute, ALB will mark the target as unhealthy. To handle this gracefully, you might want to implement a dedicated health check endpoint that returns quickly without triggering expensive operations.

### Conclusion

Using an Application Load Balancer to invoke Lambda functions offers a compelling alternative to API Gateway, especially when you already have ALB infrastructure in place or need the cost efficiency of a centralized load balancer. Understanding the event format ALB sends, respecting the 1 MB payload and 60-second timeout constraints, and properly configuring resource-based permissions are the foundation of a working integration.

The decision between ALB and API Gateway ultimately hinges on your existing infrastructure, the features you need, and the operational model you prefer. Neither is universally better — they're tools designed for different scenarios. By understanding both, you can make an informed choice that aligns with your architecture, budget, and feature requirements.
