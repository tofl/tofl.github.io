---
title: "Comparing REST APIs and HTTP APIs in API Gateway"
---

## Comparing REST APIs and HTTP APIs in API Gateway

When you're building serverless applications on AWS, one of the first decisions you'll face is choosing between REST APIs and HTTP APIs in Amazon API Gateway. On the surface, they might seem interchangeable—both sit in front of your Lambda functions and other backends, both handle HTTP requests, both support CORS and authorization. But they're actually quite different in capability, cost, and performance characteristics. Understanding these differences isn't just academic; it directly impacts how you architect your applications, what features you can deliver, and what you'll spend each month.

This comparison will walk you through the practical distinctions between these two API types, help you understand when each makes sense, and guide you through the decision-making process with real-world scenarios and cost examples.

### Understanding API Gateway's Two API Types

AWS offers two distinct flavors of API Gateway, each with its own design philosophy. REST APIs were the original offering and remain the feature-rich, kitchen-sink option. HTTP APIs are the newer, streamlined alternative released by AWS to provide a faster, cheaper option for developers who don't need every bell and whistle.

Think of REST APIs as the comprehensive toolkit you grab when you're not sure what you might need. HTTP APIs are more like the lightweight toolkit you take on a hiking trip—you've got the essentials, and they work beautifully for their intended purpose, but you're not carrying a blowtorch if you only need a screwdriver.

The fundamental difference comes down to AWS's design goals. REST APIs were built to support the full spectrum of API capabilities—complex transformations, sophisticated caching strategies, API keys, usage plans, request/response mapping templates, and deep integration with AWS services. HTTP APIs were purpose-built for the modern microservices era where you typically have a simple, clean backend (often Lambda) and you want maximum performance with minimal overhead and cost.

### Core Architecture and Protocol Differences

At a technical level, both API types sit between your clients and backends, but they handle requests differently. REST APIs use a more complex routing model and support deeper request/response processing through integration requests and integration responses—an extra layer of abstraction that gives you tremendous flexibility but adds latency and processing overhead.

HTTP APIs use a simpler, more direct routing mechanism inspired by modern API frameworks. They employ OpenAPI 3.0 specification support natively and use a more streamlined request flow. This architectural simplicity directly translates to performance gains. AWS has published that HTTP APIs have approximately 50% lower latency compared to REST APIs, and they cost roughly 70% less. Those aren't trivial differences when you're running thousands of requests per second.

The routing difference is particularly important. REST APIs route requests through a heavyweight process that evaluates method, path, and other criteria through a full API Gateway evaluation chain. HTTP APIs use lightweight path-matching that's closer to how modern frameworks like Express or FastAPI work—your route patterns are simpler and more directly map to your backend.

### Feature Comparison: What HTTP APIs Don't Have

This is where the decision becomes concrete. HTTP APIs intentionally leave out several features. Understanding which features you actually need is the key to making the right choice.

**Request and Response Transformation** is the first major gap. REST APIs let you transform request and response payloads using mapping templates. For example, you can use Apache Velocity Template Language (VTL) to restructure incoming JSON, extract values from query parameters and headers, and reshape the response from your backend before sending it to clients. With HTTP APIs, you get what you get—no transformation layer. If your backend returns data in one format and your clients expect another, you'll need to handle that transformation in your Lambda function or elsewhere in your application code.

**API Keys and Usage Plans** don't exist in HTTP APIs. REST APIs let you issue API keys to clients, track their usage, and enforce usage plans with throttling limits per key. If you're building a multi-tenant API where different customers have different rate limits, or if you need to track per-user consumption for billing purposes, you'll struggle with HTTP APIs. You'd have to implement this logic yourself in your Lambda functions or use a different service.

**Response Caching** is another REST API exclusive. With REST APIs, you can cache responses at the API Gateway level for configurable durations based on the HTTP method and path. This is incredibly valuable for read-heavy APIs where the same data is requested repeatedly. Caching at the edge (API Gateway) means you don't even invoke your backend for cache hits—your response comes back immediately. HTTP APIs don't offer this. Every request goes to your backend.

**Request/Response Validation** capabilities are more limited in HTTP APIs. REST APIs let you define schemas and validate incoming requests against them before they even reach your backend, returning validation errors immediately. HTTP APIs support basic validation through OpenAPI schemas, but it's less flexible.

**AWS Service Integration** is more capable in REST APIs. You can directly integrate REST APIs with services like DynamoDB, SQS, SNS, and Kinesis through service integrations, allowing you to send requests directly to these services without a Lambda function. HTTP APIs only support Lambda and HTTP backends—if you want to talk to DynamoDB directly, you'd need Lambda as an intermediary.

**Mutual TLS (mTLS)** for backend authentication is available in REST APIs but not HTTP APIs. If your backend requires certificate-based authentication, REST APIs support this natively through private integrations.

### When to Choose HTTP APIs

Given these limitations, you might wonder why anyone would choose HTTP APIs. The answer becomes clear when you consider the typical modern architecture and the cost/performance tradeoff.

If you're building a microservice that fronts a simple Lambda backend, HTTP APIs are usually the superior choice. Your Lambda function is your business logic; the API Gateway is just a thin request dispatcher. The simplicity of HTTP APIs maps directly to your architecture. You don't need transformation because your Lambda returns exactly what you want to send to clients. You don't need caching because your Lambda is already fast. You don't need service integrations because Lambda handles everything.

Consider a team building a real-time data processing API. Each request triggers a Lambda that queries a database, performs calculations, and returns results. There's no value in caching these fresh computations. API keys aren't needed because authentication happens at the Lambda level. Transformation doesn't help because the Lambda already formats responses correctly. In this scenario, HTTP API's simplicity is a feature, not a limitation. You get better performance for 70% of the cost. That's compelling.

HTTP APIs also shine when you're processing high volumes of requests and cost per request matters. If you're handling 10 million requests per month, that 70% cost savings represents real money. Many serverless applications see this kind of volume as they scale, and the cumulative savings becomes significant.

The newer HTTP API feature set has also expanded. AWS has added support for mutual TLS authentication to HTTP APIs and improved authorization options. With each release, some of the feature gap narrows, though REST APIs maintain advantages in transformation and caching.

### When REST APIs Are Necessary

Conversely, certain scenarios demand REST APIs' full feature set.

If you need caching, REST APIs are required. You don't have an alternative. This is critical for any read-heavy API where the same data is requested repeatedly—think a product catalog API for an e-commerce site, a weather API returning forecasts, or any public-facing data API. The performance and cost benefits of caching can be dramatic. With caching enabled, high-traffic reads don't even reach your backend.

If you're building a multi-tenant API where different customers have different rate limits and you need to track their consumption, you need API keys and usage plans. Implementing this yourself is possible but adds significant complexity. REST APIs handle it natively.

If your backend needs complex transformation of requests or responses, REST APIs' mapping templates let you handle this at the API Gateway layer. This keeps your Lambda functions focused on business logic and lets the API Gateway handle protocol concerns. For example, if clients send data in XML and your backend expects JSON, or vice versa, you'd use VTL templates to transform between them.

If you need to directly integrate with AWS services like DynamoDB or SQS without a Lambda function, REST APIs enable this through service integrations. This reduces Lambda invocations and associated costs and latency.

If you're working with legacy systems or third-party APIs that expect sophisticated request/response handling, REST APIs' transformation capabilities often make integration cleaner.

### Cost Analysis: Real Numbers

Let's work through actual cost scenarios to see where the 70% savings comes from in practice.

Assume you're running a REST API handling 100 million requests per month. At current pricing (which can change), REST API charges are $3.50 per million requests for API calls, plus additional charges for cache memory if you enable caching, plus data transfer costs. For 100 million requests without caching, you'd pay $350 per month just for API calls. If you enable cache, you'd add around $9.20 per GB-month (with a minimum charge even for small caches).

The same workload on HTTP APIs costs $0.90 per million requests. For 100 million requests, that's $90 per month. That's a difference of $260 per month, or roughly $3,120 per year, just on API Gateway costs. When you're running a cost-conscious startup or operating at scale, this matters.

The real savings compound when you consider latency improvements. Faster responses mean better user experience. Faster backends mean you can handle more throughput with fewer Lambda concurrent executions. Fewer concurrent executions mean lower Lambda compute costs. The HTTP API advantage extends beyond just the API Gateway pricing.

However, if you enable REST API caching heavily and see strong cache hit rates, the analysis changes. Suppose your cache hits on 80% of requests. Now only 20 million requests hit your backend, reducing Lambda invocations from 100 million to 20 million. At $0.0000002 per invocation, that's savings of $16 monthly—not huge. But the reduced backend load might mean you can run with fewer concurrent executions and lower provisioned capacity. More significantly, cache hits return in milliseconds compared to potential seconds for backend processing. The user experience improvement can justify REST API's higher cost.

### Routing and Request Handling Differences

The routing mechanisms deserve deeper explanation because they affect not just performance but also how you structure your API definitions.

REST API routing uses a hierarchical resource model. You define resources like `/users/{id}` as actual resource objects in the API structure, and methods like GET, POST, and DELETE attach to those resources. This model matches REST architectural principles perfectly. It's explicit and clear. However, each request goes through the full evaluation chain—resource lookup, method matching, authorization checks, request mapping, backend invocation, response mapping.

HTTP API routing uses simpler pattern matching. You define routes like `GET /users/{id}` and they directly map to your backend. The syntax is more like what you'd write in a modern web framework. Evaluation is more direct with less overhead. For simple, flat API structures, this works beautifully and performs better. For complex hierarchical APIs with many sub-resources, REST APIs' model might feel more natural.

This difference affects OpenAPI specification usage too. REST APIs support OpenAPI 2.0 (Swagger) primarily, though they can consume OpenAPI 3.0. HTTP APIs natively support OpenAPI 3.0, which is the modern standard. If you're building new APIs and using OpenAPI as your contract, HTTP APIs align better with current tooling and standards.

### Authorization and Security Considerations

Both API types support authorization, but the mechanisms differ slightly.

REST APIs support Lambda authorizers (formerly custom authorizers), IAM authorization, Cognito user pools, and Cognito identity pools. HTTP APIs support Lambda authorizers, IAM authorization, and native OIDC/OAuth 2.0 scopes through Cognito. HTTP APIs' native OIDC support is actually a significant advantage for modern applications using external identity providers.

Both support mutual TLS for backend authentication now. Both support request validation, though REST APIs are more sophisticated.

The security story is roughly equivalent between the two. Your choice here shouldn't primarily be driven by authorization requirements—both handle security properly. Instead, focus on the business logic requirements.

### Migration Paths and Strategies

If you've built a REST API and want to migrate to HTTP APIs, you're not locked in place, but the path requires some planning.

The migration strategy depends on your API's complexity. If your REST API is relatively simple—mainly just passing requests through to Lambda with minimal transformation—migration is straightforward. You'd export your API definition, adapt it to HTTP API format (mostly just syntax changes in the OpenAPI spec), and import it into a new HTTP API. Test thoroughly, then switch DNS records to point to the new endpoint.

If your API uses mapping templates for request/response transformation, you'll need to move that logic into your Lambda functions or another service. This is the main migration burden. You'll need to refactor your Lambda to handle transformations that were previously in the API Gateway layer. It's additional work but often not dramatically complex—you're just moving logic from one place to another.

If your API relies heavily on caching, you'll need to implement caching logic in your Lambda or use a separate caching layer like ElastiCache. This is more involved.

If you're using API keys and usage plans, you'll lose that functionality with HTTP APIs. You'd need to implement usage tracking and rate limiting in your Lambda or through a separate service.

For large, complex REST APIs with heavy use of service integrations, transformation, and caching, migration is likely not worth the effort. You've built on REST APIs for reasons, and moving away would require substantial rework.

A safer approach for existing APIs is running REST APIs for what they're good at and using HTTP APIs for new projects that don't need REST-specific features. Over time, you might refactor older services to use HTTP APIs, but there's no need to rush.

### Decision Framework: Choosing Between Them

Here's a practical decision process:

Start by asking whether you need any of REST API's exclusive features: caching, API keys/usage plans, service integrations, or sophisticated request/response transformation. If the answer is yes to any of these, REST API is your choice. There's no equivalent in HTTP APIs.

If you don't need those features, consider your API structure. Are you building a simple, modern microservice with Lambda backends? HTTP API is likely better—simpler, faster, cheaper. Are you building a complex API with many resource hierarchies and sophisticated business logic at the API Gateway level? REST API might be more natural, though it's not required.

Finally, consider your scale. At small scale (under a million requests monthly), the cost difference is minimal, so choose based on features and simplicity. At large scale (tens or hundreds of millions monthly), the cost difference becomes real money, and HTTP API's efficiency advantage becomes compelling if features align.

Run through some quick cost calculations based on your estimated traffic. Multiply your monthly request count by the per-million-request rate for each API type. Don't ignore the cost of caching if you're using it. Often the decision becomes obvious when you see the actual dollar difference.

### Practical Recommendation Patterns

Across common application patterns, HTTP APIs are the right choice more often than you might expect.

For mobile backends, HTTP APIs are excellent. You're usually invoking Lambda to fetch or mutate data. You want fast responses and low latency. You don't need complex transformation because your mobile team controls both sides of the API contract. You don't need caching because mobile clients handle that. Cost efficiency matters because you're paying for every request globally.

For IoT applications where devices send telemetry data, HTTP APIs work well. The requests are simple, the backend (usually Lambda writing to DynamoDB) is simple, and you want minimal latency and cost overhead.

For internal service-to-service communication within a microservices architecture, HTTP APIs shine. Services call each other directly with straightforward request/response patterns. You don't need the enterprise features REST APIs provide.

For public-facing APIs with third-party clients, REST APIs often make sense. You might want to cache responses for performance. You might want API keys to identify and track clients. You might want request validation at the API level. These features provide a better experience for your API consumers.

For webhooks and event notification systems, HTTP APIs are ideal. You're just forwarding events to client-specified URLs. Simple, direct, efficient.

### Monitoring and Operational Differences

Both API types integrate with CloudWatch for monitoring. You can track request counts, latency, errors, and cache performance (for REST APIs). Both integrate with CloudTrail for audit logging. Both work with X-Ray for distributed tracing.

The operational difference is mainly in complexity. HTTP APIs have less to configure and fewer knobs to tune, which often means fewer things to monitor. REST APIs with sophisticated caching strategies, usage plans, and transformation layers require more operational attention.

Both support VPC endpoints if you need to keep traffic private, though this is typically more relevant for REST APIs in enterprise environments.

### Testing and Deployment Considerations

Testing strategies are similar between the two, but HTTP APIs' simpler structure often means simpler test cases. You have fewer integration points to mock and fewer transformation edge cases to handle.

Deployment tools like AWS SAM, Terraform, and CDK support both API types equally well. Your infrastructure-as-code stays clean regardless of choice.

The real difference is in the feedback cycle. With HTTP APIs, you can iterate faster because there's less complexity in the API Gateway itself. You're focused on your Lambda logic. With REST APIs, you might need to iterate on both the Lambda and the API Gateway configuration.

### The Long-term Perspective

AWS continues investing in HTTP APIs. Each product update adds more capability and brings it closer to REST API feature parity. However, REST APIs aren't going anywhere—they remain essential for use cases that require their comprehensive feature set.

The trend is clear: new workloads should default to HTTP APIs unless specific features mandate REST APIs. Over time, more teams will consolidate on HTTP APIs for their simplicity and efficiency. REST APIs will become more specialized, used when their advanced features provide genuine value.

This doesn't mean REST APIs are obsolete. It means they're increasingly a tool for specific scenarios rather than the default choice. That's actually healthy architecture—using the right tool for the job rather than using one tool for everything.

## Conclusion

REST APIs and HTTP APIs serve different needs in the AWS API Gateway ecosystem. REST APIs provide comprehensive feature sets including caching, API keys, usage plans, and sophisticated request/response transformation—these are invaluable for complex, multi-tenant, or heavily-trafficked public APIs that need fine-grained control. HTTP APIs offer a leaner, faster, and significantly cheaper alternative that's perfectly suited for modern microservices, mobile backends, and any workload where simplicity and performance matter more than advanced features.

The decision between them should be driven by specific requirements rather than defaulting to one or the other. Map your needs against the feature differences, run cost calculations for your projected traffic, and choose accordingly. In practice, most new serverless applications will find HTTP APIs meet their needs beautifully, while existing complex APIs and enterprise scenarios will continue relying on REST APIs' capabilities.

As you build on AWS, returning to this decision framework regularly will help you make architectural choices that scale with your application and align with your operational needs. The best API architecture is the one that provides exactly what you need without unnecessary overhead—and increasingly, that's what HTTP APIs deliver.
