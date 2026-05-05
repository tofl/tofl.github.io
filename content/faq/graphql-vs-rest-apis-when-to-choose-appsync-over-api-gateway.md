---
title: "GraphQL vs REST APIs: When to Choose AppSync Over API Gateway"
---

## GraphQL vs REST APIs: When to Choose AppSync Over API Gateway

Building APIs is one of the fundamental tasks in modern application development. Whether you're creating a backend for a mobile app, a single-page application, or integrating microservices, the decision about *how* to structure your API layer can profoundly affect development velocity, operational efficiency, and user experience. On AWS, you have two primary technologies for this job: API Gateway, which powers REST and HTTP APIs, and AppSync, which provides managed GraphQL. But which one should you choose?

This question doesn't have a universal answer. The choice depends on your data access patterns, real-time requirements, team expertise, client characteristics, and how you value development speed versus infrastructure simplicity. Let's explore both technologies in depth and build a framework for making the right decision.

### Understanding the Fundamental Differences

API Gateway and AppSync represent two distinct philosophies for building APIs. API Gateway is Amazon's managed service for creating REST and HTTP APIs that follow traditional request-response patterns. You define endpoints, HTTP methods, and resource paths. Clients make requests to specific URLs, and your backend returns the full response for that endpoint.

AppSync, by contrast, is a managed GraphQL service. GraphQL is a query language that shifts control to the client. Instead of hitting predefined endpoints, clients send queries specifying exactly which fields they need. The server responds with precisely that data—no more, no less. This subtle difference cascades into major implications for how you design, build, and optimize your APIs.

To understand why this matters, imagine you're building a social media app. A user's profile page needs the user's name, avatar, follower count, and a list of recent posts. With a REST API, you might need to call `/users/{id}` to get the profile, then `/users/{id}/followers/count` for the follower count, then `/users/{id}/posts` for the posts. That's three round-trips. With GraphQL, you send one query requesting exactly those fields in a single request. The difference becomes even starker when you have nested relationships or when different clients need different subsets of data.

### Data Fetching Efficiency: The Over-fetching and Under-fetching Problem

One of GraphQL's most compelling advantages is its solution to over-fetching and under-fetching. Over-fetching happens when a REST endpoint returns more data than the client actually needs. Under-fetching happens when you don't get all the data you need in one response, forcing multiple requests.

Consider a mobile app with limited bandwidth. A REST endpoint that returns a user object might include 30 fields—email, phone number, preferences, settings, and more—but your mobile UI only displays five of them. You've downloaded unnecessary data, consumed battery, and wasted bandwidth. With GraphQL, you query for only those five fields. The server returns only what you asked for, making the payload smaller and the mobile experience snappier.

Under-fetching creates a different problem. Suppose you need a user's profile data *and* their recent comments. A REST API might require two endpoints: one for user data and one for comments. Your client makes two requests sequentially (or in parallel if you're clever), waiting for both to complete. Network latency compounds—if each request takes 200ms, the user sees a 400ms delay. With GraphQL, one request fetches both user and comments in a single round-trip.

This efficiency gain is particularly pronounced in mobile applications where network conditions are unpredictable. It's also valuable for single-page applications (SPAs) where JavaScript frameworks like React benefit from declarative data-fetching libraries such as Apollo Client or Relay, which are purpose-built for GraphQL.

API Gateway doesn't solve these problems inherently—it's up to you as an architect to design endpoints thoughtfully and possibly implement techniques like field filtering or response shaping. This isn't impossible, but it requires deliberate effort.

### Real-time Capabilities: WebSockets and Subscriptions

Here's where AppSync introduces a feature that REST APIs fundamentally lack: built-in subscriptions. In GraphQL, clients can subscribe to data changes. When that data updates on the server, all subscribed clients receive the update automatically. It's real-time, two-way communication without the complexity of managing WebSocket connections yourself.

AppSync handles the WebSocket infrastructure for you. You define a subscription in your GraphQL schema, and AppSync manages client connections, broadcasts updates to all subscribers, and handles disconnections gracefully. It's a managed experience that dramatically simplifies real-time features.

API Gateway *can* support WebSockets—you can create WebSocket APIs and manage connections yourself. But you're responsible for the plumbing: storing connection IDs, broadcasting messages, handling reconnection logic, and managing state. It's doable, but it's significantly more operational overhead.

If your application needs real-time features—a chat application, live notifications, collaborative editing, or stock price updates—AppSync's subscription model is remarkably elegant. You don't eliminate the WebSocket overhead; rather, AWS handles it invisibly.

If real-time is nice-to-have rather than essential, or if you're building a read-heavy API where real-time updates aren't core, this advantage diminishes.

### Schema-Driven Contracts and Self-Documentation

GraphQL APIs are fundamentally schema-driven. Your schema is the contract between client and server. It defines every type, every field, every possible query, and every subscription. The schema is introspectable, meaning clients can query it to discover what's available.

This has profound implications. First, the schema *is* the documentation. Tools like GraphQL Playground or Apollo Studio automatically generate interactive documentation by introspecting the schema. A developer integrating with your API doesn't need to read Markdown docs—they can explore the schema in a live environment, see field descriptions, and try queries.

Second, the schema enforces a strict contract. If a client requests a field that doesn't exist in the schema, the server rejects it immediately with a clear error. There's no ambiguity about what a "user" object contains or what parameters an operation accepts. This explicitness catches integration errors early.

REST APIs require separate documentation. You might use OpenAPI (Swagger) to describe your endpoints, but it's an additional artifact you must maintain separately from your code. There's room for documentation and implementation to drift. A developer using your API relies on your documentation being accurate, which is human-dependent.

API Gateway can generate OpenAPI specs, but it's not automatic or introspectable the way GraphQL schemas are. You need to actively maintain your OpenAPI definition.

For teams that value developer experience and want to reduce the friction of API integration, GraphQL's self-documenting nature is a significant advantage.

### Authorization and Authentication Patterns

Both services support multiple authorization mechanisms, but they differ in how naturally each integrates.

AppSync offers built-in authorization directives in your schema. You can declare authorization rules directly on fields and types using `@auth` directives. For example, you might specify that only the post's author can delete it, or that only authenticated users can access private data. These rules are declarative and colocated with your schema, making them easier to reason about and audit.

AppSync supports several authorization types: API key (simple, development-friendly), IAM (integrates with AWS identity), OpenID Connect (for third-party providers), and Amazon Cognito (native AWS identity). You can even use Lambda authorizers for custom logic.

API Gateway's authorization model is more flexible but requires more configuration. You attach authorization to methods and stages. You can use IAM, Lambda authorizers, or API key restrictions. The authorization logic lives separately from your resource definitions, which can make it harder to see at a glance what's protected and how.

Neither service is inherently better for authorization—it depends on your identity architecture. If you're already using Cognito or IAM, AppSync's integration feels natural. If you have custom authorization logic or third-party identity providers, both services can accommodate it, though the configuration approach differs.

### Caching Strategies

Caching is critical for API performance, and both services support it, but differently.

API Gateway offers edge caching through CloudFront integration. You can enable caching per method, and API Gateway respects HTTP cache headers (Cache-Control). It's a standard HTTP caching model—straightforward if you're familiar with web standards, but somewhat coarse-grained. You cache entire endpoint responses or nothing.

AppSync offers more granular field-level caching through its AppSync caching layer. You can set different TTLs for different types and fields. If you're caching a user object, you might cache the user's name for 1 hour but their follower count for 5 minutes because it changes more frequently. This fine-grained control maps better to how GraphQL resolvers work—you cache individual field resolutions, not entire queries.

AppSync also integrates naturally with DynamoDB's TTL and with other caching backends. For GraphQL, field-level caching is a more natural fit than endpoint-level caching because queries are dynamic—two clients requesting the same endpoint might request different fields, making endpoint-level caching suboptimal.

That said, if you're already comfortable with HTTP caching semantics and your API's response cardinality is low (you have a manageable number of distinct responses), API Gateway's caching is simpler to reason about.

### Pricing and Operational Cost

Both services charge per request, but the structure differs significantly.

API Gateway charges per million HTTP requests. You also pay for data transfer out. If you're building a public API with millions of requests monthly, the per-request cost is your dominant expense.

AppSync charges per million requests, but with a lower base cost per request at scale. However, it also charges for real-time messages. If you use subscriptions, each message sent to subscribed clients counts as a request. For chat applications or highly interactive dashboards, this can multiply your request count dramatically.

The pricing math matters. A simple REST API serving thousands of requests monthly might cost $3–5 with API Gateway. The same workload with AppSync (without subscriptions) might cost $1–2. But add subscriptions, and the calculus changes. A chat application with 1000 users exchanging 100 messages per hour might run $10/month on API Gateway with WebSockets (you pay for compute on EC2 or Lambda), but could cost $50+/month with AppSync subscriptions if you're broadcasting to many subscribers.

This isn't an argument against AppSync—the features justify the cost. Rather, it's a reminder that pricing should inform architecture. If you're building a write-heavy collaborative application with many subscribers, AppSync's subscription costs might be acceptable given the operational simplicity. If you're building a read-only API with no real-time component, API Gateway's pay-per-request model might offer better economics.

### Learning Curve and Team Expertise

This is often overlooked but genuinely important: which technology does your team already know?

REST APIs are ubiquitous. Nearly every developer has built or consumed a REST API. The concepts are familiar: HTTP methods, status codes, headers, and resource-oriented design. If your team has never encountered GraphQL, there's a learning curve. You need to understand queries, mutations, subscriptions, schema definition, and resolver functions. Some developers find GraphQL's paradigm shift initially confusing.

AppSync's resolver system uses VTL (Velocity Template Language) or JavaScript/TypeScript to map GraphQL operations to backend resources. The syntax is specific to AppSync. If you're accustomed to writing handlers in Lambda with API Gateway, AppSync's resolver model feels different.

Conversely, if your team *has* GraphQL experience, AppSync's schema-driven approach feels natural, and the real-time capabilities feel like superpowers compared to REST.

API Gateway pairs naturally with Lambda. You write functions, API Gateway routes requests to them—no special abstraction. The mental model is simple: request comes in, Lambda function runs, response goes out.

For teams with strong REST and Lambda expertise, API Gateway is the path of least resistance. For teams that have invested in GraphQL or are building GraphQL-first applications, AppSync is purpose-built.

### Typical Use Cases and Decision Patterns

Let's ground this in concrete scenarios. When should you choose AppSync, and when should API Gateway remain your go-to?

**Choose AppSync if:**

Your primary clients are mobile or single-page applications where bandwidth and round-trip efficiency matter. Mobile apps especially benefit from GraphQL's data precision and real-time subscriptions. If you're building a companion app to a web platform, AppSync is compelling.

Your data model is complex with many relationships. If user profiles have comments, which have likes, which have user references, GraphQL's nested querying is elegant. You avoid the N+1 query problem naturally and let clients request precisely the structure they need.

You need real-time features. Subscriptions are genuinely easier with AppSync than managing WebSockets manually with API Gateway.

You want schema-driven contracts and developer experience. If your API is internal or semi-public and you want to minimize integration friction, GraphQL's introspectable schema is valuable.

You're already using AWS's serverless ecosystem heavily (Lambda, DynamoDB) and want a managed service that plays nicely with those. AppSync integrates seamlessly with Lambda and DynamoDB resolvers.

**Choose API Gateway if:**

You're building a public API that external developers will integrate with. REST is the lingua franca of APIs. Most developers understand it, and they can integrate using simple HTTP clients. GraphQL adds a layer of unfamiliarity for some consumers.

Your API is relatively simple with clear, independent resources. If your API is mostly CRUD operations on a few entities, REST's simplicity is adequate.

You have existing REST APIs and want consistency. Migration is a cost; standardizing on one style reduces cognitive load.

You're building microservices that communicate internally. Microservices often benefit from REST's simplicity and the fact that you can easily call one service from another using basic HTTP.

You need maximum flexibility in HTTP semantics. API Gateway lets you control headers, status codes, and request/response transformations directly. GraphQL abstracts away some of these details (though you can still access them if needed).

You're cost-conscious for a read-heavy, low-subscription workload. API Gateway's per-request pricing can be cheaper for certain profiles.

### Hybrid Approaches

In practice, many teams use both. You might build your primary API with AppSync for internal client consumption, then layer API Gateway on top to expose a simplified REST interface to public consumers. Or you build a REST API with API Gateway, then add GraphQL via AppSync for your mobile clients.

AppSync can also delegate to HTTP backends via resolver data sources, so you can build a GraphQL layer over existing REST APIs. This is valuable when modernizing existing architectures—you can offer GraphQL to clients without rewriting everything.

### Making Your Decision

Here's a decision framework to apply to your specific situation:

Start by understanding your clients. Are they mobile? Web? Internal microservices? Mobile and web clients typically benefit from GraphQL's efficiency. Internal APIs have different constraints and concerns.

Map your data model. Complex interconnected data benefits from GraphQL's nested query capability. Simple, independent resources work fine with REST.

Identify real-time requirements. Are subscriptions essential or optional? Essential points toward AppSync. Optional suggests API Gateway is sufficient.

Evaluate your team's expertise. Can you afford a learning curve for GraphQL, or do you need immediate productivity? This matters more than you might think.

Consider operational simplicity. AppSync is managed and relatively hands-off. API Gateway plus Lambda requires you to manage state, caching, authorization, and error handling yourself—it's more DIY.

Do pricing math specific to your workload. Run numbers for your estimated request volume and subscription patterns.

Think long-term. The technology you choose will shape how you think about your API for years. REST is more "dumb pipe"—flexible but you handle much yourself. GraphQL is more opinionated—constraints in exchange for built-in features.

Neither choice is wrong. API Gateway powers many successful APIs across AWS. AppSync is increasingly chosen for new projects, especially those with mobile clients. The "right" answer is the one that aligns with your specific situation.

### Conclusion

AppSync and API Gateway solve the same fundamental problem—exposing application logic to clients—but with different trade-offs. API Gateway offers simplicity, familiarity, and a clean HTTP abstraction. AppSync offers efficiency, real-time capabilities, and a schema-driven developer experience.

The decision isn't about which technology is objectively better. It's about matching the technology to your use case, your team, and your architectural priorities. A mobile-first startup might choose AppSync immediately and reap enormous productivity gains. An established company exposing a public API might choose API Gateway because REST is the expected interface. A team building microservices might use both, with AppSync for client-facing APIs and API Gateway for service-to-service communication.

As you build APIs on AWS, take time to understand your requirements deeply before choosing. Prototype small pieces in both technologies if you're uncertain. The right choice becomes clear when you understand not just the features of each service, but how those features map to the problems you're actually solving.
