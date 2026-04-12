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

{{< qcm >}}
[
{
"question": "A developer is building a serverless API backed by AWS Lambda. The requirements are minimal: JWT authorization, CORS support, and low cost. Which API Gateway API type should they choose?",
"answers": [
{
"answer": "REST API",
"isCorrect": false,
"explanation": "REST API supports all features including JWT authorization and CORS, but it is more expensive and has higher latency than HTTP API. It is overkill when advanced features like API keys or caching are not needed."
},
{
"answer": "HTTP API",
"isCorrect": true,
"explanation": "HTTP API is the lightweight, lower-cost, lower-latency alternative to REST API. It natively supports JWT authorization, CORS, and Lambda integrations — making it the ideal choice for simple Lambda-backed APIs where cost and performance matter."
},
{
"answer": "WebSocket API",
"isCorrect": false,
"explanation": "WebSocket API is designed for persistent, bidirectional connections (e.g., chat apps, live dashboards). It is not appropriate for a standard request/response API pattern."
}
]
},
{
"question": "A company wants to expose an internal microservice that should never be accessible from the public internet. Which API Gateway deployment type should be used?",
"answers": [
{
"answer": "Edge-Optimized",
"isCorrect": false,
"explanation": "Edge-Optimized fronts the API with the CloudFront global network and is intended for geographically distributed public clients. It does not restrict public internet access."
},
{
"answer": "Regional",
"isCorrect": false,
"explanation": "Regional endpoints are publicly accessible from the internet. While they are optimal for same-region clients, they do not provide network isolation from the public internet."
},
{
"answer": "Private",
"isCorrect": true,
"explanation": "Private APIs are only accessible from within a VPC via an interface VPC endpoint. They have no public internet exposure, making them the correct choice for internal microservices that must not be publicly reachable."
}
]
},
{
"question": "An API Gateway REST API uses a Lambda Proxy integration. A browser-based application hosted on a different domain calls this API and receives a CORS error. What is the correct fix?",
"answers": [
{
"answer": "Enable CORS in the API Gateway console using the one-click option.",
"isCorrect": false,
"explanation": "The one-click 'Enable CORS' option in the console configures CORS at the API Gateway level for non-proxy integrations. With Lambda Proxy, API Gateway passes the response through unchanged, so this setting alone is insufficient."
},
{
"answer": "Add the required CORS headers (e.g., Access-Control-Allow-Origin) in the Lambda function's response.",
"isCorrect": true,
"explanation": "For Lambda Proxy integrations, API Gateway forwards the Lambda response directly to the client without modification. Therefore, the Lambda function itself must include the necessary CORS headers in its response."
},
{
"answer": "Switch to an HTTP API, which handles CORS automatically.",
"isCorrect": false,
"explanation": "HTTP API does support CORS configuration, but the question specifies a REST API with Lambda Proxy integration. Switching API types is not required; adding CORS headers in the Lambda response is the direct fix."
}
]
},
{
"question": "A developer needs to route traffic from the same API Gateway configuration to different Lambda aliases depending on the deployment stage (dev vs. prod). What is the recommended approach?",
"answers": [
{
"answer": "Create a separate API Gateway API for each stage.",
"isCorrect": false,
"explanation": "Creating separate APIs per stage duplicates configuration and is unnecessary. API Gateway stages are specifically designed to handle per-environment differences within a single API."
},
{
"answer": "Use stage variables to reference different Lambda aliases in the integration URI.",
"isCorrect": true,
"explanation": "Stage variables act like environment variables for a stage. By setting a stage variable (e.g., lambdaAlias) to 'dev' or 'prod' and referencing it in the Lambda ARN with ${stageVariables.lambdaAlias}, the same API configuration can route to different Lambda aliases per stage without duplicating resources."
},
{
"answer": "Use canary deployments to split traffic between Lambda aliases.",
"isCorrect": false,
"explanation": "Canary deployments are used to gradually shift a percentage of production traffic to a new deployment version for testing. They are not the mechanism for routing dev vs. prod traffic to different Lambda aliases."
}
]
},
{
"question": "Which API Gateway integration type allows you to call an AWS service (e.g., put an item in DynamoDB) directly, without invoking a Lambda function?",
"answers": [
{
"answer": "Lambda Proxy",
"isCorrect": false,
"explanation": "Lambda Proxy forwards the full request to a Lambda function. It does not bypass Lambda to call AWS services directly."
},
{
"answer": "AWS Service",
"isCorrect": true,
"explanation": "The AWS Service integration type allows API Gateway to call an AWS service action directly (e.g., DynamoDB PutItem, SQS SendMessage) without an intermediate Lambda function, reducing latency and cost."
},
{
"answer": "Mock",
"isCorrect": false,
"explanation": "Mock integrations return a predefined response without calling any backend at all. They are useful for stubbing endpoints during development, not for integrating with AWS services."
},
{
"answer": "HTTP",
"isCorrect": false,
"explanation": "HTTP integration forwards requests to any public HTTP endpoint. It is not designed for direct integration with AWS service APIs."
}
]
},
{
"question": "A team is developing an API and wants to return a static response for a health-check endpoint without invoking any backend. Which integration type should they use?",
"answers": [
{
"answer": "Lambda Proxy",
"isCorrect": false,
"explanation": "Lambda Proxy always invokes a Lambda function to generate a response. It cannot return a static response without a backend invocation."
},
{
"answer": "HTTP",
"isCorrect": false,
"explanation": "HTTP integration forwards requests to an external HTTP endpoint. A backend must still be called."
},
{
"answer": "Mock",
"isCorrect": true,
"explanation": "Mock integration allows API Gateway to return a response you define without invoking any backend. This is ideal for health-check endpoints or stubbing out routes during development."
}
]
},
{
"question": "An API Gateway REST API receives requests whose payload structure differs from what the backend Lambda expects. The developer wants to transform the payload at the gateway layer rather than in the Lambda code. What feature should they use?",
"answers": [
{
"answer": "Stage variables",
"isCorrect": false,
"explanation": "Stage variables store configuration values per stage (like environment variables). They are not used to transform request/response payloads."
},
{
"answer": "Mapping templates (VTL)",
"isCorrect": true,
"explanation": "Mapping templates written in Velocity Template Language (VTL) allow you to transform the request payload before it reaches the backend and the response before it reaches the client. They are available on REST APIs with non-proxy integrations."
},
{
"answer": "Lambda Proxy integration",
"isCorrect": false,
"explanation": "Lambda Proxy passes the full, unmodified request to Lambda. Payload transformation must then happen inside the Lambda function itself, which is exactly what the developer wants to avoid."
}
]
},
{
"question": "A developer wants to add user authentication to a REST API. Users will authenticate via Amazon Cognito and send a JWT in the Authorization header. API Gateway should validate the token automatically without requiring a custom Lambda. Which authorizer type should be used?",
"answers": [
{
"answer": "IAM authorization",
"isCorrect": false,
"explanation": "IAM authorization requires callers to sign requests using AWS Signature Version 4. It is suited for internal AWS-to-AWS calls where the caller has an IAM identity, not for end-user authentication with JWTs."
},
{
"answer": "Lambda authorizer (token-based)",
"isCorrect": false,
"explanation": "A token-based Lambda authorizer can validate JWTs, but it requires writing and maintaining a custom Lambda function. The question explicitly asks for automatic validation without a Lambda."
},
{
"answer": "Cognito User Pool authorizer",
"isCorrect": true,
"explanation": "The Cognito User Pool authorizer validates JWTs issued by a Cognito User Pool automatically — verifying the token signature and expiry — without requiring a Lambda function. It is the most straightforward path for user authentication on REST APIs."
}
]
},
{
"question": "A security team wants to restrict access to an API Gateway REST API so that only requests from a specific AWS account and a specific IP range are allowed. Which feature should be used?",
"answers": [
{
"answer": "Usage plans and API keys",
"isCorrect": false,
"explanation": "Usage plans and API keys are used for rate limiting and quota management, primarily for API monetization. They identify callers but are not an authentication or access-control mechanism."
},
{
"answer": "Resource policies",
"isCorrect": true,
"explanation": "Resource policies are JSON policies attached directly to the API that control which principals (AWS accounts, IAM users, IP ranges, VPCs) can invoke it. They are the correct tool for cross-account access restrictions and IP-based filtering."
},
{
"answer": "Lambda authorizer (request-based)",
"isCorrect": false,
"explanation": "A request-based Lambda authorizer can make authorization decisions based on headers, query parameters, and other context, but it requires a custom Lambda function. Resource policies are the native, simpler solution for account and IP-based restrictions."
}
]
},
{
"question": "What is the purpose of API keys in API Gateway?",
"answers": [
{
"answer": "To authenticate and secure API access by verifying the caller's identity.",
"isCorrect": false,
"explanation": "API keys are not an authentication or security mechanism. They are used for identification and rate limiting — they do not verify the caller's identity in a secure way."
},
{
"answer": "To identify callers and enforce throttle and quota limits defined in usage plans.",
"isCorrect": true,
"explanation": "API keys are strings sent in the x-api-key header. API Gateway uses them to identify callers and apply the throttle (requests per second) and quota (total requests per period) limits defined in the associated usage plan. They are suited for API monetization and tiered service offerings."
},
{
"answer": "To encrypt traffic between the client and API Gateway.",
"isCorrect": false,
"explanation": "Encryption in transit is handled by TLS/HTTPS, not by API keys. API keys have nothing to do with transport-layer encryption."
}
]
},
{
"question": "An API Gateway stage has caching enabled. A client wants to bypass the cache and force a fresh response from the backend. What must the client include in the request?",
"answers": [
{
"answer": "x-api-key header with a valid API key",
"isCorrect": false,
"explanation": "The x-api-key header is used for API key identification and usage plan enforcement. It has no effect on cache behavior."
},
{
"answer": "Cache-Control: max-age=0 header",
"isCorrect": true,
"explanation": "Clients can invalidate a cached response by sending the Cache-Control: max-age=0 header (if the API is configured to allow cache invalidation). This instructs API Gateway to bypass the cache and fetch a fresh response from the backend."
},
{
"answer": "Authorization: Bearer invalidate header",
"isCorrect": false,
"explanation": "There is no such cache invalidation mechanism using the Authorization header. Cache invalidation is controlled via the Cache-Control header."
}
]
},
{
"question": "A company wants to gradually roll out a new version of their API to 10% of production traffic before fully promoting it. Which API Gateway feature supports this?",
"answers": [
{
"answer": "Stage variables",
"isCorrect": false,
"explanation": "Stage variables store per-stage configuration values. They are not used to split traffic between deployment versions."
},
{
"answer": "Canary deployments",
"isCorrect": true,
"explanation": "Canary releases allow you to route a configurable percentage of production traffic (e.g., 10%) to a new stage deployment. Once validated, you can promote the canary to full traffic or roll it back — all with no downtime."
},
{
"answer": "Lambda aliases with weighted routing",
"isCorrect": false,
"explanation": "Lambda aliases do support weighted traffic shifting between Lambda versions, but the question asks about an API Gateway feature. Canary deployments are the native API Gateway mechanism for gradual rollouts."
}
]
},
{
"question": "A developer is building a real-time collaborative editing application where the server must push updates to connected clients at any time. Which API Gateway API type is most appropriate?",
"answers": [
{
"answer": "REST API",
"isCorrect": false,
"explanation": "REST APIs follow a request/response model. The server cannot push data to clients without the client initiating a request, which is not suitable for real-time server-to-client push."
},
{
"answer": "HTTP API",
"isCorrect": false,
"explanation": "HTTP API is also a request/response model optimized for low cost and latency. It does not support persistent connections or server-to-client push."
},
{
"answer": "WebSocket API",
"isCorrect": true,
"explanation": "WebSocket API maintains persistent, bidirectional connections between clients and the backend. The backend can push messages to any connected client at any time using the API Gateway Management API (POST /@connections/{connectionId}), making it ideal for real-time collaborative applications."
}
]
},
{
"question": "In a WebSocket API, how does the backend push a message to a specific connected client?",
"answers": [
{
"answer": "By invoking the Lambda function with the client's connection ID as the payload.",
"isCorrect": false,
"explanation": "The backend does not push messages by invoking Lambda. Lambda is invoked by API Gateway when a client sends a message. Server-to-client push uses a different mechanism."
},
{
"answer": "By calling the API Gateway Management API endpoint POST /@connections/{connectionId}.",
"isCorrect": true,
"explanation": "API Gateway assigns each connection a unique connection ID. The backend sends messages to a specific client by calling POST /@connections/{connectionId} on the API Gateway Management API. This enables true server-to-client push without polling."
},
{
"answer": "By publishing the message to an SNS topic that the client subscribes to.",
"isCorrect": false,
"explanation": "SNS is a separate pub/sub service and is not the mechanism for pushing messages through a WebSocket API connection. The correct approach is the API Gateway Management API."
}
]
},
{
"question": "In a WebSocket API, a client sends the following message: {\"action\": \"chat\", \"text\": \"Hello\"}. The route selection expression is set to $request.body.action. Which route will be invoked?",
"answers": [
{
"answer": "$connect",
"isCorrect": false,
"explanation": "$connect is invoked only when a client first establishes a WebSocket connection, not when messages are sent."
},
{
"answer": "chat",
"isCorrect": true,
"explanation": "The route selection expression $request.body.action evaluates to the value of the action field in the message body, which is 'chat'. API Gateway will route this message to the 'chat' route."
},
{
"answer": "$default",
"isCorrect": false,
"explanation": "$default catches messages that do not match any defined route. Since the message's action value ('chat') matches a defined route, $default would not be invoked."
}
]
},
{
"question": "A developer wants to capture detailed information about each API request to an API Gateway REST API, including caller IP, HTTP status code, and latency, for use in analytics. Which logging option is most appropriate?",
"answers": [
{
"answer": "Execution logs",
"isCorrect": false,
"explanation": "Execution logs capture detailed internal information about request processing (payloads, integration details, errors). They are useful for debugging but are verbose, costly at scale, and not the recommended option for analytics or auditing."
},
{
"answer": "Access logs",
"isCorrect": true,
"explanation": "Access logs record who called the API and the result of each request. You define a custom log format using $context variables (e.g., caller IP, status code, latency), making them well-suited for analytics and auditing."
},
{
"answer": "CloudWatch metrics",
"isCorrect": false,
"explanation": "CloudWatch metrics (4XX errors, 5XX errors, latency, count) provide aggregated, numeric data suitable for alarms and dashboards. They do not capture per-request details like caller IP or custom fields needed for analytics."
}
]
},
{
"question": "Which of the following statements about API Gateway REST API caching are correct? (Select TWO)",
"answers": [
{
"answer": "Caching is available on HTTP APIs and REST APIs.",
"isCorrect": false,
"explanation": "Caching is only available on REST APIs. HTTP APIs do not support response caching."
},
{
"answer": "The default cache TTL is 300 seconds, with a maximum of 3600 seconds.",
"isCorrect": true,
"explanation": "API Gateway REST API caching defaults to a TTL of 300 seconds (5 minutes) and can be configured up to a maximum of 3600 seconds (1 hour)."
},
{
"answer": "Caching is enabled per stage and can be overridden at the individual resource/method level.",
"isCorrect": true,
"explanation": "Caching is configured per stage, but you can override the caching behavior for specific resources or methods, giving fine-grained control over what is and is not cached."
},
{
"answer": "Caching is billed based on the number of requests served from cache.",
"isCorrect": false,
"explanation": "Caching is billed per hour based on the cache size you configure, not per request served from cache."
}
]
},
{
"question": "A Lambda authorizer is needed to make an authorization decision based not only on a token, but also on query string parameters and stage variables. Which type of Lambda authorizer should be used?",
"answers": [
{
"answer": "Token-based Lambda authorizer",
"isCorrect": false,
"explanation": "A token-based Lambda authorizer receives only a single token (e.g., a JWT from a header). It does not have access to query parameters or stage variables."
},
{
"answer": "Request-based Lambda authorizer",
"isCorrect": true,
"explanation": "A request-based Lambda authorizer receives the full request context, including headers, query parameters, and stage variables. It is the correct choice when the authorization decision depends on more than just a token."
},
{
"answer": "Cognito User Pool authorizer",
"isCorrect": false,
"explanation": "A Cognito User Pool authorizer validates JWTs from Cognito automatically. It does not execute custom logic or consider query parameters and stage variables in its authorization decision."
}
]
},
{
"question": "A developer is deploying an API Gateway REST API for clients distributed across multiple continents and wants to minimize latency without managing a custom CDN. Which deployment type should be selected?",
"answers": [
{
"answer": "Regional",
"isCorrect": false,
"explanation": "A Regional endpoint serves requests from a single AWS region. Geographically distant clients will experience higher latency because requests must travel all the way to that region."
},
{
"answer": "Edge-Optimized",
"isCorrect": true,
"explanation": "Edge-Optimized deployment fronts the API with the CloudFront global network. Requests from geographically distributed clients are routed to the nearest CloudFront edge location, reducing latency — without requiring the developer to set up and manage a custom CloudFront distribution."
},
{
"answer": "Private",
"isCorrect": false,
"explanation": "Private APIs are only accessible within a VPC and have no public internet exposure. They are not suitable for serving external clients across multiple continents."
}
]
}
]
{{< /qcm >}}