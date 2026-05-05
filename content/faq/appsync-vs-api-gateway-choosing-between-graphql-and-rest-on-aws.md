---
title: "AppSync vs API Gateway: Choosing Between GraphQL and REST on AWS"
---

## AppSync vs API Gateway: Choosing Between GraphQL and REST on AWS

When you're building an application on AWS, choosing the right API technology is a foundational decision that affects your architecture, development velocity, and operational costs. Two leading options stand out: AWS AppSync for GraphQL-based APIs and API Gateway for REST or HTTP-based APIs. Both are powerful, mature services that solve real problems—but they solve different problems in different ways.

In this article, we'll explore what makes each service tick, examine the scenarios where one outshines the other, and walk through the practical trade-offs you'll face when designing your API layer. Whether you're building a mobile app that needs real-time updates or a backend service that serves multiple consumer types, understanding these differences will help you make a confident choice.

### Understanding the Fundamental Architectural Difference

The most important distinction between AppSync and API Gateway comes down to the data fetching model and the mental model you adopt when designing your API.

API Gateway follows the traditional REST architectural style. You define multiple endpoints—each representing a resource or action—and clients make specific requests to those endpoints. A mobile app might hit `/users/{id}` to fetch user details, then separately call `/users/{id}/posts` to get that user's posts, and finally call `/posts/{postId}/comments` to retrieve comments. Each request is independent, and the client orchestrates the flow of data retrieval. This approach has proven itself over decades of web development and remains the standard approach for most HTTP APIs you encounter.

AppSync, on the other hand, implements GraphQL—a query language and runtime that fundamentally changes how clients request data. Instead of making multiple requests to different endpoints, a client sends a single query describing exactly what data it needs. That same mobile app might send one request asking for "give me user details along with their posts and each post's comments" all in one shot. The server processes this nested query and returns only the data requested, no more and no less.

This isn't merely a cosmetic difference. The architectural implications ripple throughout your system. REST's multi-endpoint approach naturally encourages you to think about resources and how they relate through URLs. GraphQL's single-endpoint approach encourages you to think about the shape of the data your clients actually need and design your resolver layer accordingly.

### Data Fetching Model: Single Endpoint vs. Multiple Endpoints

Let's make this concrete with an example. Imagine you're building a social media application.

With API Gateway and REST, you might expose endpoints like:
- `GET /api/users/{userId}` — returns user profile information
- `GET /api/users/{userId}/posts` — returns all posts by that user
- `GET /api/posts/{postId}` — returns details about a specific post
- `GET /api/posts/{postId}/comments` — returns comments on a post
- `GET /api/comments/{commentId}/author` — returns the author of a comment

A typical web or mobile client needs to orchestrate multiple requests. If your UI displays a user profile with their recent posts and comments, you'll make at least three API calls (possibly more, depending on your design). Each call has overhead—network latency, authentication/authorization checks, connection establishment. This pattern is called the "N+1 problem" when taken to extremes: fetching a list of users followed by fetching details for each user results in 1 + N queries.

With AppSync and GraphQL, you define a single endpoint (`/graphql`) and clients describe what data they need using queries:

```graphql
query GetUserWithPosts($userId: ID!) {
  user(id: $userId) {
    id
    name
    email
    posts {
      id
      title
      content
      comments {
        id
        text
        author {
          id
          name
        }
      }
    }
  }
}
```

The server receives this query, understands the shape of data requested, and fetches exactly that. One request, one round trip, fully specified. The flexibility is powerful—different clients can request different shapes of data from the same endpoint without requiring new API endpoints.

However, this comes with a caveat. GraphQL requires more sophisticated backend logic to resolve nested fields efficiently. The resolver layer must be carefully designed to avoid the N+1 problem on the server side. A naive resolver implementation might fetch a user's posts, then for each post fetch its comments, then for each comment fetch the author—resulting in many database queries even though it's a single API request. We'll explore resolver strategies later.

### Real-Time Capabilities: Subscriptions and WebSockets

One area where AppSync significantly differentiates itself is real-time communication through GraphQL subscriptions.

API Gateway can certainly support real-time functionality through WebSocket APIs, which it launched to address exactly this need. When you create a WebSocket API in API Gateway, you can establish persistent connections between clients and your backend. You manage connection state, route messages based on route selection expressions, and handle connect/disconnect events. It's powerful, but it's a manual process—you define the connection management logic, the message routing, and the state persistence yourself.

AppSync, by contrast, has real-time subscriptions baked directly into the GraphQL model. You define subscriptions alongside queries and mutations in your schema:

```graphql
type Subscription {
  onPostCreated: Post!
  onCommentAdded(postId: ID!): Comment!
}
```

When a mutation (like creating a new post) occurs, AppSync automatically notifies all clients with active subscriptions for that event. The subscription mechanism is integrated with your resolver layer. You don't need to manually manage WebSocket connections or route messages—AppSync handles the plumbing.

This integration makes AppSync particularly well-suited for collaborative applications, live dashboards, chat systems, and any scenario where multiple users need to see near-instantaneous updates to shared data. The developer experience is substantially smoother than managing WebSocket connections manually in API Gateway.

That said, API Gateway's WebSocket APIs aren't a weakness—they're just more flexible and lower-level. If you need fine-grained control over connection management or need to support custom real-time protocols beyond GraphQL subscriptions, API Gateway WebSocket might be the better choice.

### Authorization and Security Models

Both services provide multiple authorization mechanisms, but the details matter significantly for your security posture.

API Gateway supports several authorization strategies. API Keys are the simplest approach—useful for development, public APIs, or rate limiting known clients. However, they're not suitable for authenticating users. AWS Identity and Access Management (IAM) authorization leverages AWS credential signing and is ideal for service-to-service communication or when your API consumers are AWS principals. Cognito User Pools provide user authentication with familiar username/password flows or social login integration. Cognito Identity Pools handle authorization for temporary AWS credentials. Finally, Lambda authorizers (formerly called custom authorizers) let you implement arbitrary authorization logic—verifying a JWT token, making an external call to an authorization service, or checking a database. Lambda authorizers provide maximum flexibility at the cost of additional latency and complexity.

AppSync supports all of these same mechanisms and adds an additional option: OpenID Connect (OIDC) providers. This native OIDC support is valuable if you're integrating with third-party identity providers like Auth0, Okta, or other OIDC-compliant systems. Beyond basic authorization, AppSync also integrates authorization directly into your resolver layer through field-level authorization rules, allowing you to specify which users can access which fields in your schema using declarative syntax.

Here's a practical difference: with API Gateway, authorization is typically an all-or-nothing gate at the endpoint level. A Lambda authorizer evaluates whether a request is allowed to hit `/users/{id}`, but it doesn't know about field-level access. With AppSync, you can express that "user Alice can read the `email` field on their own user object but not on other users' objects" directly in your resolver logic or through authorization rules.

For straightforward scenarios, both are equally capable. For complex authorization requirements involving field-level access control, AppSync's integration makes implementation cleaner.

### Integration Patterns: Resolvers vs. Lambda Integrations

Here's where the rubber meets the road in terms of implementation complexity.

With API Gateway, you integrate your backend through straightforward mechanisms. A Lambda integration directly invokes a Lambda function, passing the HTTP request and returning its response. An HTTP integration forwards the request to an HTTP endpoint (a traditional web server, for instance). AWS service integrations call other AWS services directly. These integrations are relatively simple to understand: request comes in, gets forwarded, response comes back.

AppSync uses resolvers—small programs that execute when a GraphQL field is accessed. These resolvers are written in Apache Velocity Template Language (VTL), a lightweight templating language, or as Lambda functions. VTL resolvers are fast and lightweight, executing directly without cold starts. They excel at transforming data, calling AWS services, and simple business logic. A typical VTL resolver might prepare a DynamoDB query based on field arguments, execute it, and transform the result into the expected schema shape.

Let's see what a VTL resolver looks like:

```vtl
{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "userId": $util.dynamodb.toDynamoDBJson($ctx.arguments.userId)
  }
}
```

This resolver directly invokes DynamoDB's GetItem operation. The `$ctx` object contains contextual information—arguments passed to the field, identity information of the requester, and more. VTL provides utilities for common tasks like format conversion, list manipulation, and error handling.

For more complex logic, you can use Lambda resolvers. These work similarly to API Gateway Lambda integrations but in the context of a specific field resolution. A Lambda resolver might validate business rules, orchestrate calls to multiple services, or run custom code that's easier to express in Python, Node.js, or another language than in VTL.

The resolver approach has a learning curve for developers unfamiliar with GraphQL architecture. Each field in your schema needs a resolver (or an implicitly defaulting one for simple cases). You're building a data fetching layer that understands your schema, not just endpoint handlers. But this investment pays dividends in the form of flexibility, type safety, and the ability to resolve nested data efficiently.

### Caching Strategies

Both services provide caching, but in different ways.

API Gateway caches responses at the CloudFront edge locations based on HTTP cache headers or configured time-to-live values. A `GET /users/123` request might be cached for 60 seconds. Subsequent requests within that window return the cached response without hitting your backend. This is standard HTTP caching and is incredibly effective for read-heavy APIs. However, cache invalidation is coarse-grained—you can't easily say "invalidate the cache for this specific user when their profile is updated." You either set a fixed TTL or manually flush the entire cache.

AppSync provides both a query cache and a resolver-level cache. The query cache caches entire GraphQL query results, but its utility is limited because GraphQL queries often include variables and return different results for different inputs. The more powerful caching mechanism is at the resolver level—you can configure which resolvers cache their results and for how long. This means you can cache the result of fetching a user's profile independently of caching the result of fetching their posts. Crucially, you can use AWS AppSync's invalidation API to programmatically invalidate specific cache entries when data changes, providing more granular control than HTTP caching.

For many applications, AppSync's resolver-level caching aligns more naturally with how you think about your data. You cache user profiles separately from post feeds because they have different change frequencies and access patterns. This granularity is harder to achieve with API Gateway's HTTP caching layer.

That said, API Gateway's integration with CloudFront is powerful for global applications. Responses are cached at edge locations close to users, reducing latency significantly. AppSync caches responses in a centralized cache layer, which is effective but doesn't provide the geographic distribution of CloudFront.

### Cost Implications

Cost is a practical consideration that shouldn't be overlooked.

API Gateway charges based on the number of requests received. As of this writing, the cost is approximately $3.50 per million requests. Data transfer out is charged separately. You pay for what you use, with minimal fixed costs. This model is attractive for predictable traffic patterns or when your API is accessed irregularly.

AppSync uses a different pricing model: you pay a flat monthly fee for the API (approximately $45 per month) plus charges for query and mutation executions. Query execution is cheaper than mutation execution (reflecting that mutations are typically heavier operations). Each gigabyte of data transfer also incurs charges. For low-traffic applications, API Gateway is often cheaper due to AppSync's minimum monthly fee. For high-traffic applications with consistent load, AppSync's per-request cost can be lower, especially if you're making efficient use of the platform's caching and subscription features.

There's also an indirect cost to consider: operational and development complexity. AppSync requires learning GraphQL and VTL (or investing in Lambda resolvers). API Gateway is more familiar territory for most developers. The "cheaper on paper" option might not be the cheapest once you factor in development time and operational overhead.

Calculate your expected traffic, factor in your team's comfort with the technology, and run the numbers for your specific use case.

### Choosing the Right Tool

With all this context, how do you decide which service to use?

**Choose API Gateway if:**

Your API follows a REST model with well-defined resource endpoints. You're building a straightforward HTTP API that serves multiple client types (web, mobile, third-party developers). Your team is very comfortable with REST and HTTP standards. You want simplicity and straightforwardness—API Gateway is arguably the most familiar path for most developers. Your API traffic is unpredictable or bursty, making the per-request pricing model attractive. You need deep integration with CloudFront for geographic distribution and edge caching. You're building a microservice that needs to expose a traditional HTTP interface.

**Choose AppSync if:**

Your clients need flexibility in what data they request, and you want to avoid the N+1 problem of multiple REST calls. Your application requires real-time subscriptions and you want that integrated seamlessly into your API layer. Your data access patterns involve complex nesting or relationships that are awkward to express as REST resources. You're building a backend for multiple client types (web app, mobile app, TV app) that each need different data shapes. Your authorization requirements include field-level access control. You have consistent, high traffic that favors AppSync's pricing model. Your team is comfortable (or willing to invest time) in learning GraphQL and resolver architecture.

Neither choice is permanently binding. You can start with API Gateway and migrate to AppSync if your needs evolve, or vice versa. Many organizations use both—AppSync for modern client applications that benefit from GraphQL, and API Gateway for external APIs or service-to-service communication that fits the REST model naturally.

### A Practical Scenario

Let's walk through a realistic example to tie this together. Suppose you're building a music streaming application with a mobile app and a web app.

The mobile app needs to be conservative with network requests due to battery and data usage concerns. Users typically view their library, search for new music, and create playlists. A REST API would require the mobile app to make numerous requests: fetch the user's profile, then fetch their library (which requires iterating through each playlist to fetch their songs). With AppSync, the mobile app sends a single query: "fetch my profile with all my playlists and their songs." The app gets exactly what it needs in one round trip.

The mobile app also benefits from real-time updates. When another user adds a song to a shared playlist, the current user should see that update appear immediately. AppSync's subscriptions handle this elegantly. API Gateway WebSocket APIs could provide the same functionality, but you'd be responsible for managing the connection state, routing messages, and triggering updates when mutations occur.

Meanwhile, your web app is perfectly happy with REST endpoints because it's less bandwidth-constrained. You might expose a traditional REST API alongside your AppSync GraphQL API, serving both client types from the same backend data sources.

This hybrid approach is common and sensible—there's no requirement to standardize on one or the other across your entire organization.

### Conclusion

AppSync and API Gateway represent two different philosophies for building APIs on AWS. API Gateway and REST are the familiar, proven approach—straightforward to understand and implement, serving the majority of API use cases well. AppSync and GraphQL are the modern approach—more flexible in terms of what clients can request, with superior real-time capabilities and field-level authorization built in, but requiring more investment in understanding GraphQL architecture and resolver design.

The decision comes down to the specific needs of your application, your team's expertise, your traffic patterns, and your tolerance for new technology. There's genuine merit to both approaches, and the AWS ecosystem is better for having these two options available. As you architect your next API, evaluate your requirements against the characteristics we've discussed—data fetching patterns, real-time needs, authorization complexity, and cost expectations. With this framework in mind, you'll be well-equipped to make a decision that serves your application and your team well.
