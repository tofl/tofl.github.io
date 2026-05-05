---
title: "Lambda Function URLs: Auth Modes, CORS, and Practical Use Cases"
---

# Lambda Function URLs: Auth Modes, CORS, and Practical Use Cases

## Introduction

AWS Lambda has long been the workhorse of serverless compute, but historically getting an HTTPS endpoint in front of a function required API Gateway—a powerful tool, but one that introduced complexity for simpler use cases. Lambda Function URLs, introduced in 2022, change that equation entirely. They provide a straightforward way to create public or authenticated HTTPS endpoints directly on Lambda functions with minimal configuration overhead.

If you're building a quick webhook receiver, prototyping a microservice, or need a simple authenticated API without the operational burden of managing an API Gateway, Function URLs deserve your attention. This article covers everything you need to understand how they work, when to use them, and how to configure them properly—including the two authentication modes, CORS handling, and real-world scenarios where they shine.

## Understanding Lambda Function URLs

A Lambda Function URL is a dedicated HTTPS endpoint that AWS creates for your function. When you enable it, you get a unique URL in the format:

```
https://<url-id>.lambda-url.<region>.on.aws/
```

The `<url-id>` portion is a randomly generated identifier that makes each URL globally unique. Behind the scenes, AWS manages the HTTPS layer, certificate rotation, and the routing from the public internet directly to your Lambda function. No load balancers, no API Gateway resource definitions—just a function and its endpoint.

This simplicity comes with a tradeoff: Function URLs are intentionally lightweight. They don't offer the full feature set of API Gateway (like request transformation, authorization layers, usage plans, or API versioning). But for many scenarios, that's exactly the right amount of functionality.

## The Two Authentication Modes

Authentication mode is the first decision you'll make when configuring a Function URL. You have two options, each suited to different scenarios.

### NONE: Public Endpoints

When you set the auth mode to `NONE`, the function URL accepts unauthenticated requests from anyone. The endpoint is genuinely public—no credentials required. AWS still performs basic request validation (checking HTTP method, headers, and payload format), but there's no authentication layer.

Use `NONE` when you're building webhooks that external services will call, public APIs, or rapid prototypes. For example, if you're implementing a GitHub webhook receiver that processes push events, GitHub's servers need to make unauthenticated HTTP requests to your endpoint. Setting auth to `NONE` makes this straightforward.

The security model here relies on the URL itself being secret (it's hard to guess) and, ideally, on the payload validation your function performs. If a webhook is supposed to come from GitHub, your function should verify the signature that GitHub includes in the request. This shifts the responsibility from the Lambda layer to your application logic, which is a reasonable design for public endpoints.

### AWS_IAM: SigV4-Signed Requests

When you set the auth mode to `AWS_IAM`, Lambda Function URLs require that requests be signed using AWS Signature Version 4 (SigV4). This is the same signing mechanism that powers all AWS API calls.

With `AWS_IAM` authentication enabled, a request to your Function URL must include SigV4 signature headers. AWS Lambda validates these signatures using the caller's AWS credentials before invoking your function. If the signature is invalid or missing, the request is rejected with a 401 Unauthorized response.

This mode is ideal for service-to-service communication within your AWS ecosystem, or for cases where you want the requestor to prove their AWS identity. For instance, if you have a Lambda function in Account A that needs to call a Lambda Function URL in Account B, you'd use `AWS_IAM` and configure the appropriate cross-account IAM permissions. The caller's function would sign the request with its own credentials, and Account B's Lambda would validate it.

Here's a practical example: imagine you're building a distributed system where multiple Lambda functions need to invoke a shared utility function. Rather than setting up API Gateway with complex authorization, you could create a Function URL with `AWS_IAM` auth, then grant the calling functions an IAM policy permitting them to invoke it. The AWS SDK handles SigV4 signing automatically.

```python
import boto3
import json

# The caller (in the same or different account) makes a signed request
client = boto3.client('lambda')

# This assumes your function has permissions to invoke the target Function URL
# The SDK signs the request automatically
response = client.invoke(
    FunctionName='arn:aws:lambda:us-east-1:123456789012:function:my-function:url',
    InvocationType='RequestResponse',
    Payload=json.dumps({'key': 'value'})
)

result = json.loads(response['Payload'].read())
```

Actually, when using the Lambda service itself, the SDK's `invoke` action is more direct than making an HTTP call to the Function URL. But if you're invoking from outside the AWS SDK (perhaps from a web application or a third-party tool), you'd craft an HTTP request and use a SigV4 signing library to add the necessary headers.

For non-AWS code, libraries like the AWS SDK for JavaScript, Python, Java, or Go all include SigV4 signing utilities. The request would look something like this in Python:

```python
import requests
from requests_auth_aws4 import AWS4Auth
import os

# Sign the request with your AWS credentials
credentials = AWS4Auth(
    os.environ['AWS_ACCESS_KEY_ID'],
    os.environ['AWS_SECRET_ACCESS_KEY'],
    'us-east-1',
    'lambda'
)

response = requests.post(
    'https://<url-id>.lambda-url.us-east-1.on.aws/',
    json={'key': 'value'},
    auth=credentials
)
```

The critical insight is that `AWS_IAM` authentication ties access control to AWS identity and access management, which integrates beautifully with your existing security infrastructure.

## Configuring CORS

If your Function URL will be called from a web browser—say, from a single-page application—you need to handle Cross-Origin Resource Sharing (CORS). CORS is a browser security mechanism that prevents scripts on one origin from making requests to endpoints on different origins unless those endpoints explicitly allow it.

When you configure a Function URL, you specify CORS settings that control which origins can make requests, which HTTP methods are permitted, which headers the browser is allowed to send, and which headers the response can include.

A typical CORS configuration might look like:

- **Allowed Origins**: `https://myapp.example.com` (or `*` if you want to allow any origin)
- **Allowed Methods**: `GET`, `POST`
- **Allowed Headers**: `Content-Type`, `X-Custom-Header`
- **Expose Headers**: `X-Response-Header`
- **Max Age**: 86400 (how long the browser caches the CORS preflight response)

When you configure these settings, AWS Lambda automatically handles CORS preflight requests (the browser's `OPTIONS` requests) by returning the appropriate `Access-Control-*` headers. Your function never sees the preflight request—Lambda handles it transparently.

If you're calling the Function URL from a browser, ensure your CORS configuration is permissive enough. If you're calling it from a backend service or a CLI tool, CORS doesn't apply (it's only enforced by browsers).

## Request and Response Payload Format

Lambda Function URLs don't parse the request body or format the response for you. Instead, you receive the raw HTTP request and you're responsible for parsing and responding.

When your Lambda function is invoked by a Function URL, the event object looks like:

```json
{
  "requestContext": {
    "http": {
      "method": "POST",
      "path": "/",
      "protocol": "HTTP/1.1",
      "sourceIp": "203.0.113.45",
      "userAgent": "curl/7.64.1"
    },
    "timeEpoch": 1702000000000,
    "domainName": "<url-id>.lambda-url.us-east-1.on.aws",
    "accountId": "123456789012",
    "authentication": {
      "clientCert": null
    }
  },
  "rawPath": "/",
  "rawQueryString": "foo=bar&baz=qux",
  "headers": {
    "accept": "*/*",
    "content-length": "13",
    "content-type": "application/json",
    "host": "<url-id>.lambda-url.us-east-1.on.aws",
    "user-agent": "curl/7.64.1",
    "x-forwarded-for": "203.0.113.45",
    "x-forwarded-port": "443",
    "x-forwarded-proto": "https"
  },
  "body": "{\"key\": \"value\"}",
  "isBase64Encoded": false
}
```

The `body` field contains the request payload as a string. If the request includes binary data, the body is base64-encoded and the `isBase64Encoded` flag is set to `true`. You'll need to decode it before processing.

Query string parameters are provided in `rawQueryString`, not parsed into a convenient object—you'll need to parse them yourself or use a utility library. The HTTP method is in `requestContext.http.method`, headers are in the `headers` object (note that header names are lowercased), and the source IP is available in `requestContext.http.sourceIp`.

Your function should return a response object with the following structure:

```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json",
    "Custom-Header": "value"
  },
  "body": "{\"message\": \"success\"}",
  "isBase64Encoded": false
}
```

The `statusCode` is required and should be an HTTP status code (200, 404, 500, etc.). Headers are optional but recommended if you want to control content type or add custom headers. The `body` must be a string. If you want to return binary data, base64-encode it and set `isBase64Encoded` to `true`.

Here's a practical example in Python:

```python
import json

def lambda_handler(event, context):
    # Parse the request body
    try:
        body = json.loads(event['body']) if event.get('body') else {}
    except json.JSONDecodeError:
        return {
            'statusCode': 400,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': 'Invalid JSON'})
        }
    
    # Get query parameters
    query_string = event.get('rawQueryString', '')
    
    # Get the HTTP method
    method = event['requestContext']['http']['method']
    
    # Process the request and build a response
    result = {
        'received_method': method,
        'received_body': body,
        'query_string': query_string
    }
    
    return {
        'statusCode': 200,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps(result)
    }
```

## Throttling and Rate Limiting

Lambda Function URLs are subject to Lambda's standard concurrency limits. Each AWS account has a default reserved concurrency limit (typically 1000 concurrent executions across all functions), and Function URLs respect this. If your function URL receives more concurrent requests than your concurrency allowance, excess requests receive a 502 Bad Gateway response.

You can set a function-level concurrency limit to reserve capacity for other functions or to prevent a single Function URL from monopolizing your account's concurrency. Requests that exceed this limit are immediately rejected with a 429 (Too Many Requests) status code.

There's no built-in rate limiting per IP address or API key at the Function URL level. If you need sophisticated rate limiting (such as allowing 100 requests per minute per user), you'll need to implement that logic in your function or use a service like API Gateway, which offers throttling policies.

For many use cases—webhooks, internal APIs, lightweight microservices—the default concurrency model is sufficient. But if you're building a public-facing API that needs explicit rate limiting, Function URLs might not be the right fit.

## Using Aliases for Blue/Green Deployments

One of the more sophisticated features of Lambda Function URLs is the ability to attach a URL to a specific function version or alias, rather than just the $LATEST version. This enables blue/green deployment patterns where you can shift traffic between versions without changing the URL.

Here's how it works: you create two versions of your function—$LATEST (the "green" version, where you deploy new code) and a named alias like "production" (the "blue" version, currently serving traffic). You attach the Function URL to the "production" alias, so that calls to the URL consistently invoke that version.

When you're ready to deploy new code, you publish a new version, update the "production" alias to point to the new version, and traffic immediately shifts. If something goes wrong, you can quickly roll back by pointing the alias back to the previous version. The URL itself never changes.

To attach a Function URL to an alias using the AWS CLI:

```bash
aws lambda create-function-url-config \
  --function-name my-function \
  --qualifier production \
  --auth-type AWS_IAM \
  --cors AllowOrigins='["https://myapp.example.com"]',AllowMethods='["GET","POST"]'
```

The `--qualifier` parameter specifies the alias (or a version number). If you omit it, the URL is attached to $LATEST, which is suitable for development but risky for production.

This pattern is particularly valuable for zero-downtime deployments. Your Function URL points to a stable alias, and you manage versions and rollbacks behind the scenes. It's a lightweight alternative to API Gateway if blue/green deployments are important to your workflow.

## Real-World Use Cases

Lambda Function URLs excel in several practical scenarios. Understanding where they shine—and where they're not the right tool—helps you make informed architectural decisions.

### Webhooks and Event Receivers

Webhooks are an ideal use case. GitHub, Stripe, Twilio, and countless other services can send events to an HTTP endpoint. You create a Function URL with auth mode `NONE`, point your webhook provider at it, and let Lambda handle the event processing. Your function receives the webhook payload, validates any signatures the provider includes, and processes the event accordingly.

A GitHub webhook handler might look like:

```python
import json
import hmac
import hashlib

def lambda_handler(event, context):
    # Get the webhook secret from environment
    secret = os.environ['GITHUB_WEBHOOK_SECRET']
    
    # Verify the signature
    body = event['body']
    signature = event['headers'].get('x-hub-signature-256', '')
    
    expected_signature = 'sha256=' + hmac.new(
        secret.encode(),
        body.encode(),
        hashlib.sha256
    ).hexdigest()
    
    if not hmac.compare_digest(signature, expected_signature):
        return {
            'statusCode': 401,
            'body': json.dumps({'error': 'Unauthorized'})
        }
    
    # Process the webhook
    payload = json.loads(body)
    event_type = event['headers'].get('x-github-event', '')
    
    # Handle push events, pull requests, etc.
    if event_type == 'push':
        print(f"Push to {payload['repository']['name']}")
    
    return {
        'statusCode': 202,
        'body': json.dumps({'status': 'accepted'})
    }
```

This is lightweight, requires no API Gateway configuration, and scales automatically with Lambda's concurrency model.

### Simple Internal APIs

For service-to-service communication within your AWS environment, Function URLs with `AWS_IAM` authentication are compelling. You avoid the overhead of setting up API Gateway, and you get direct AWS identity integration. A microservice in one account can call a utility function in another account by making a signed HTTP request.

This pattern works well for internal tools, data processing pipelines, and inter-Lambda communication that doesn't fit cleanly into event-driven architectures.

### Rapid Prototyping and MVPs

When you're prototyping an idea or building a minimum viable product, Function URLs let you get an endpoint live in seconds. No API Gateway definition, no complex configuration—enable the Function URL and you're done. This is perfect for hackathons, proof-of-concept projects, and situations where you need to validate an idea before investing in a more sophisticated architecture.

### Lightweight Form Handlers

A simple form on a website might submit to a Lambda Function URL that processes the data, stores it in DynamoDB, and sends a confirmation email via SES. The function handles the HTTP parsing, executes the business logic, and returns a response. For straightforward form processing, this beats setting up API Gateway and additional infrastructure.

## When to Stick with API Gateway

Despite their appeal, Lambda Function URLs aren't always the right choice. API Gateway remains essential when you need:

**Request and response transformation**: API Gateway can map request payloads to different formats, add request/response headers, or modify the body before it reaches your function. Function URLs pass the raw request through, requiring your function to handle all transformation logic.

**Authorization and API keys**: API Gateway offers multiple authorization mechanisms (API keys, OAuth 2.0, Cognito, Lambda authorizers) and usage plans tied to those identities. Function URLs support only `NONE` or `AWS_IAM`, with no built-in mechanisms for per-user rate limiting or API key management.

**Request validation**: API Gateway can validate requests against JSON schema before they reach your function, rejecting malformed requests with a 400 response before invoking your code. Function URLs always invoke your function, requiring you to perform validation in code.

**Resource versioning and staging**: API Gateway supports versioning (v1, v2, v3 endpoints) and stages (dev, staging, prod) as first-class concepts. Function URLs are simpler and don't have built-in versioning; you'd need to manage versions through function aliases or URLs.

**Sophisticated caching and throttling**: API Gateway caches responses and offers fine-grained throttling policies. Function URLs rely on Lambda's concurrency model and don't support response caching.

**Logging and metrics**: API Gateway integrates deeply with CloudWatch, CloudTrail, and X-Ray. Function URLs generate basic logs but lack API Gateway's detailed request/response logging.

The decision rule is straightforward: start with a Function URL if your requirements are simple and you want low friction. Migrate to API Gateway if you find yourself building request validation, transformation, or sophisticated authorization logic in your function code—those are signals that API Gateway's features would be worthwhile.

## Configuration and Deployment

You can create and manage Lambda Function URLs through the AWS Management Console, the AWS CLI, or infrastructure-as-code tools like CloudFormation and Terraform. Here's how to set one up via the CLI:

```bash
# Create a Function URL with public access
aws lambda create-function-url-config \
  --function-name my-function \
  --auth-type NONE

# Output includes the URL
# {
#   "FunctionUrl": "https://abcdefgh1234567890.lambda-url.us-east-1.on.aws/",
#   "FunctionArn": "arn:aws:lambda:us-east-1:123456789012:function:my-function",
#   "AuthType": "NONE",
#   "Cors": {}
# }
```

To add CORS configuration:

```bash
aws lambda update-function-url-config \
  --function-name my-function \
  --auth-type AWS_IAM \
  --cors AllowOrigins='["https://myapp.example.com","https://www.example.com"]',\
AllowMethods='["GET","POST"]',\
AllowHeaders='["Content-Type","X-Custom-Header"]',\
ExposeHeaders='["X-Response-Header"]',\
MaxAge=86400
```

To retrieve the current configuration:

```bash
aws lambda get-function-url-config --function-name my-function
```

To delete a Function URL:

```bash
aws lambda delete-function-url-config --function-name my-function
```

In CloudFormation, a Function URL is defined as a resource:

```yaml
Resources:
  MyFunctionUrl:
    Type: AWS::Lambda::Url
    Properties:
      TargetFunctionArn: !Ref MyFunction
      AuthType: AWS_IAM
      Cors:
        AllowOrigins:
          - https://myapp.example.com
        AllowMethods:
          - GET
          - POST
        AllowHeaders:
          - Content-Type
        MaxAge: 86400
```

For Terraform, the resource is similarly straightforward:

```hcl
resource "aws_lambda_function_url" "example" {
  function_name      = aws_lambda_function.example.function_name
  authorization_type = "AWS_IAM"

  cors {
    allow_origins     = ["https://myapp.example.com"]
    allow_methods     = ["GET", "POST"]
    allow_headers     = ["Content-Type"]
    expose_headers    = ["X-Response-Header"]
    max_age           = 86400
  }
}
```

## Security Considerations

Lambda Function URLs are secure by default when auth is set to `AWS_IAM`, but `NONE` mode requires careful thought. Here are key considerations:

**URL secrecy**: When using `NONE` authentication, the security model assumes the URL is secret. URLs are long and randomly generated, making them hard to guess by brute force. However, they're not cryptographically secret. Don't treat them as passwords. If a Function URL is accidentally exposed (committed to a public repository, shared in logs), anyone who finds it can invoke your function.

**Payload validation**: For public Function URLs, always validate and authenticate payloads at the application level. If a webhook is supposed to come from a specific service, verify the signature. If an API is supposed to accept requests only from certain sources, check the `sourceIp` in the request context (though note that this can be spoofed in networks with proxies).

**Logging and monitoring**: Enable CloudWatch Logs for your function and monitor for unusual patterns. A Function URL that suddenly receives thousands of requests might indicate that it's been discovered and is being scanned or exploited.

**Resource exhaustion**: A public Function URL can be targeted by attackers to exhaust your Lambda concurrency, potentially impacting other functions in your account. Consider setting a per-function concurrency limit to prevent a single Function URL from consuming all available capacity.

**Sensitive data**: Never log request or response bodies if they contain sensitive information (passwords, API keys, personally identifiable information). Treat Function URLs the same way you'd treat any HTTP endpoint exposed to the internet.

## Conclusion

Lambda Function URLs democratize the creation of HTTP endpoints for serverless workloads. They eliminate the operational overhead of API Gateway for simple use cases while maintaining deep integration with AWS identity and access management. Whether you're building a webhook receiver, a lightweight internal API, or a rapid prototype, Function URLs offer a compelling alternative that gets out of your way.

The key to effective use is understanding the boundary between what Function URLs do well and where they fall short. Embrace them for simplicity and speed, but recognize when a more sophisticated gateway like API Gateway becomes necessary. Use `NONE` authentication for public webhooks and external integrations, and `AWS_IAM` for trusted service-to-service communication. Configure CORS thoughtfully if you're serving browsers, and always validate payloads at the application level.

With this mental model, you'll find Function URLs are a valuable tool in your serverless toolkit, enabling faster iteration and simpler architectures for the problems they're designed to solve.
