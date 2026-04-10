---
title: "17. API Gateway"
type: docs
weight: 1
---

## API Gateway

Amazon API Gateway [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/welcome.html) is a fully managed service for creating, publishing, and securing APIs at any scale. The core problem it solves: your backend logic (a Lambda function, an EC2 service, or any HTTP endpoint) isn't directly accessible to clients in a controlled, secure, or scalable way. API Gateway sits in front of those backends and handles routing, authentication, throttling, and protocol management — so you don't have to build any of that yourself.

### API Types

API Gateway offers three distinct API types, each designed for a different communication pattern [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-vs-rest.html):

- **REST API** — The original, feature-rich option. Supports the full suite of API Gateway features: usage plans, API keys, request/response transformation, per-resource caching, and fine-grained authorization. Use this when you need advanced control.
- **HTTP API** — A lightweight, lower-latency, lower-cost alternative to REST API. It covers most common use cases (Lambda and HTTP integrations, JWT authorization, CORS) but drops some REST API features like API keys and caching. Prefer this for simple Lambda-backed APIs where cost and latency matter.
- **WebSocket API** — Maintains persistent, bidirectional connections between clients and your backend. Ideal for real-time scenarios like chat applications, live dashboards, or collaborative tools.

### Integration Types

When a request arrives at API Gateway, it needs to be forwarded to a backend. The integration type defines how that forwarding works [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-integration-types.html):

- **Lambda Proxy** — API Gateway passes the full request (headers, query params, body, context) as a structured JSON event to Lambda. Lambda is responsible for returning a properly formatted response object. This is by far the most common pattern for Lambda-backed APIs — simple to configure and predictable.
- **Lambda Custom** (Non-Proxy) — You control exactly what gets sent to Lambda and what comes back, using mapping templates. More flexible but more configuration work.
- **AWS Service** — Integrate directly with an AWS service action (e.g., publish a message to SQS, put an item in DynamoDB) without a Lambda in between. Useful for reducing latency and cost when Lambda is just a pass-through.
- **HTTP** — Forward requests to any public HTTP endpoint (your own server, a third-party API). Available in proxy and non-proxy variants.
- **Mock** — API Gateway returns a response you define without touching any backend. Useful for stubbing out endpoints during development or for returning static health-check responses.

### Stages and Stage Variables

A **stage** [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-stages.html) is a named snapshot of your deployed API (e.g., `dev`, `staging`, `prod`). Each stage gets its own invoke URL and can have its own settings — logging level, throttling, caching, and canary configuration.

**Stage variables** [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/aws-api-gateway-stage-variables-reference.html) act like environment variables for your stage. You can reference them in integration URIs and mapping templates using the syntax `${stageVariables.variableName}`. A common pattern: set a stage variable `lambdaAlias` to `dev` or `prod`, and reference it in the Lambda ARN — so the same API configuration routes to different Lambda aliases per stage without duplicating resources.

### Deployment Types

The deployment type determines where API Gateway's infrastructure is located relative to your clients and your backend [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-endpoint-types.html):

- **Edge-Optimized** — The API is fronted by the CloudFront global network. Requests from geographically distributed clients are routed to the nearest CloudFront edge, reducing latency. The actual API Gateway endpoint still lives in one region.
- **Regional** — The endpoint lives in a specific AWS region. Best when your clients are also in that region (e.g., same-region EC2 or Lambda callers), or when you want to manage your own CloudFront distribution in front of it.
- **Private** — The API is only accessible from within a VPC via an interface VPC endpoint. No public internet exposure whatsoever. Use this for internal microservices that should never be publicly reachable.

### Usage Plans and API Keys

Usage plans [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-api-usage-plans.html) let you control who can call your API and at what rate. You define a **throttle** (requests per second, burst limit) and a **quota** (total requests per day/week/month), then associate those limits with an API key.

API keys are strings your clients include in the `x-api-key` request header. API Gateway validates the key and applies the corresponding plan's limits. This is typically used for third-party API monetization or for tiered service offerings — not as an authentication mechanism (API keys are for identification and rate limiting, not security).

### Authorization

API Gateway supports several authorization mechanisms, and selecting the right one matters for both security and exam questions.

**Resource policies** [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-resource-policies.html) are JSON policies attached directly to the API. They control which principals (AWS accounts, IAM users, IP ranges, VPCs) can invoke it. Useful for cross-account access or IP-based restrictions.

**IAM authorization** [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/permissions.html) requires callers to sign requests using AWS Signature Version 4 (SigV4). The caller's IAM identity is verified, and its IAM permissions are checked against the API. Best suited for internal AWS-to-AWS calls where the caller already has an IAM identity.

**Lambda authorizers** [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-use-lambda-authorizer.html) let you run custom authorization logic. You write a Lambda function that receives the incoming request, validates it (checking a token, calling an external auth service, parsing request attributes), and returns an IAM policy indicating allow or deny. There are two variants:
- *Token-based* — Receives a single token (e.g., a JWT or OAuth token) from a header.
- *Request-based* — Receives the full request context: headers, query parameters, stage variables. More flexible; use when the auth decision depends on more than just a token.

**Cognito User Pool authorizer** [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-integrate-with-cognito.html) validates JWTs issued by an Amazon Cognito User Pool. The client authenticates with Cognito, receives a JWT, and sends it in the `Authorization` header. API Gateway validates the token's signature and expiry automatically — no Lambda needed. This is the most straightforward path for adding user authentication to a REST API.

### Request/Response Mapping Templates (VTL)

Available on REST APIs with non-proxy integrations, mapping templates [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-mapping-template-reference.html) let you transform the request before it hits your backend and the response before it reaches the client. They're written in **Velocity Template Language (VTL)**, a templating syntax that can read incoming data, manipulate it, and produce a new payload.

A common use case: your backend expects a specific JSON structure that differs from what the client sends. Rather than burdening your Lambda with that translation, you define a mapping template to reshape the payload at the gateway layer. For the DVA-C02 exam, focus on recognizing when VTL is needed (non-proxy REST API integrations) and the basic syntax patterns — you won't need to write complex templates from scratch.

### CORS Configuration

When a browser-based application calls your API from a different domain, the browser enforces CORS (Cross-Origin Resource Sharing). API Gateway must respond to the browser's preflight `OPTIONS` request with the appropriate headers (`Access-Control-Allow-Origin`, `Access-Control-Allow-Methods`, etc.) [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html).

For **Lambda Proxy integrations**, your Lambda function must include CORS headers in its response — API Gateway passes the response through unchanged. For **non-proxy integrations**, you configure CORS at the API Gateway level. The console has a one-click "Enable CORS" option that sets up the `OPTIONS` method and required headers automatically.

### Caching

REST APIs support response caching per stage [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-caching.html). When enabled, API Gateway caches backend responses for a configurable TTL (default 300 seconds, max 3600). Subsequent identical requests are served from cache without hitting your backend — reducing latency and backend load.

You can override caching behavior at the individual resource/method level. Clients can invalidate a cached response by sending the `Cache-Control: max-age=0` header (if you allow it). Caching is billed per hour based on the cache size you configure, so it's primarily useful for GET endpoints with expensive or stable backend responses.

### Canary Deployments

Canary releases [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/canary-release.html) let you route a small percentage of production traffic to a new stage deployment before fully promoting it. You configure a canary on a stage specifying the percentage of traffic to divert (e.g., 5%) and optionally override stage variables for the canary traffic. Once you're confident in the new version, you promote the canary (making it the full stage deployment) or roll it back. This is API Gateway's built-in mechanism for gradual rollouts with no downtime.

### Logging and CloudWatch Integration

API Gateway integrates with CloudWatch for both logging and metrics [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-logging.html). There are two types of logs:

- **Execution logs** — Detailed logs of what happens during a request: the request/response payloads, integration request/response, any errors. Useful for debugging but can be verbose and costly at scale.
- **Access logs** — A record of who called your API and the result. You define the log format using a JSON template with `$context` variables (caller IP, status code, latency, etc.). Better suited for auditing and analytics.

Enable logging per stage. API Gateway also emits CloudWatch **metrics** automatically (4XX errors, 5XX errors, latency, count), which you can alarm on without any extra configuration.

### WebSocket API

A WebSocket API [🔗](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-websocket-api.html) maintains a persistent connection between a client and API Gateway. Instead of HTTP methods, you work with **routes** based on message content.

The **route selection expression** (e.g., `$request.body.action`) tells API Gateway which field in the incoming message to use to determine the route. For example, a message `{"action": "sendMessage", "data": "..."}` would match a `sendMessage` route. Three routes are always available:
- `$connect` — Invoked when a client establishes a connection.
- `$disconnect` — Invoked when a connection closes.
- `$default` — Catches messages that don't match any defined route.

API Gateway assigns each connection a unique **connection ID**. Your backend can push messages back to a specific client at any time by calling the API Gateway Management API [`POST /@connections/{connectionId}`](https://docs.aws.amazon.com/apigateway/latest/developerguide/apigateway-how-to-call-websocket-api-connections.html) — this is what enables true server-to-client push without polling.