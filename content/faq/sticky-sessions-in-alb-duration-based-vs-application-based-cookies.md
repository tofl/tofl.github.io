---
title: "Sticky Sessions in ALB: Duration-Based vs Application-Based Cookies"
---

## Sticky Sessions in ALB: Duration-Based vs Application-Based Cookies

When you deploy applications on AWS behind an Application Load Balancer (ALB), you often face a fundamental question: should requests from the same client always go to the same backend instance, or can they be distributed freely across your fleet? The answer hinges on how your application manages session state—and understanding sticky sessions is crucial for building resilient, scalable systems.

Sticky sessions, also called session affinity, are a mechanism that routes subsequent requests from the same client to the same target instance. On ALB, you have two distinct flavors: duration-based stickiness using an AWS-managed cookie, and application-based stickiness where ALB respects a cookie your application creates. Both sound appealing on the surface, but each carries architectural trade-offs that can make or break your application's reliability and performance. This article pulls back the curtain on how they work, when to use them, and—more importantly—when *not* to use them.

### Understanding the Stickiness Problem

Before diving into ALB's sticky session mechanisms, let's establish why this matters. Imagine you run a web application behind an ALB with three backend instances. When a user logs in, their session data—perhaps their user ID, preferences, shopping cart—gets stored in memory on Instance A. If the next request from that user lands on Instance B or C, those instances have no knowledge of the session. Your application crashes. Users see login screens where they shouldn't, or worse, they access someone else's data.

This scenario illustrates the core problem: distributed systems are stateless by design, which is good for scalability but bad when applications hoard state locally. Sticky sessions are one way to work around this problem, but they're often a band-aid rather than a cure.

### Duration-Based Stickiness: The AWSALB Cookie

When you enable stickiness on an ALB target group, the load balancer injects its own cookie called `AWSALB`. This cookie contains an encrypted reference to the specific target instance that handled the client's initial request. On subsequent requests, the ALB reads this cookie and routes the traffic to the same target, as long as that target is healthy and the cookie hasn't expired.

The duration is configurable—you can set it anywhere from one second to seven days, with a default of one day. The ALB manages this entirely; your application never needs to know the cookie exists. This is both a strength and a limitation.

Here's how it works in practice: A user's browser makes a request to your ALB. The ALB routes it to Instance A and returns a response with a `Set-Cookie` header for `AWSALB`. The browser stores this cookie and includes it in the next request. The ALB decrypts it, verifies the target is healthy, and sends the request back to Instance A. Simple and transparent.

The key advantage of duration-based stickiness is simplicity. You don't modify your application code; you don't orchestrate cookie exchanges. You enable a toggle in the target group settings and you're done. For legacy applications or those where you can't easily externalize session state, this feels like a lifeline.

But here's where the architectural debt comes due. If Instance A becomes unhealthy or gets terminated during a scale-in event, all the sticky sessions pointing to it are orphaned. The ALB will route those clients to a different instance—the cookie will be invalidated because the target no longer exists—and users will lose their session state. You'll see logout events, shopping carts cleared, or worse. The stickiness duration doesn't protect you here; it creates a false sense of security.

### Application-Based Stickiness: Honoring Your Own Cookies

Application-based stickiness takes a different approach. Instead of ALB injecting its own cookie, you configure the load balancer to examine a cookie that *your application* creates. Common examples include `JSESSIONID` (Java), `PHPSESSID` (PHP), or any custom session identifier you set.

When you enable application-based stickiness, you specify the cookie name. The ALB reads that cookie from incoming requests and extracts the session identifier. It then maintains an internal mapping of that identifier to the target instance that originally handled the request. Subsequent requests with the same cookie are routed to the same target.

This approach offers more control. Your application decides what goes in the cookie, when it's created, and how long it persists. For example, you might set your application's session cookie to expire after 30 minutes of inactivity, which is more sensible than a blanket 7-day duration. The ALB simply respects the association you've established.

However, application-based stickiness shares the same vulnerability as duration-based stickiness: it's brittle in the face of instance failures or scaling events. If the target instance dies or gets removed during an autoscaling event, the session affinity is broken. Users get rerouted to a different instance and lose their local session state.

### The Real Problem: Relying on Local Session State

This is the moment where we need to step back and ask a harder question: should you be storing session state locally at all?

The answer, for most modern distributed applications, is no. Local in-memory session storage creates several problems beyond just instance failures. It fragments your session state across multiple instances, making debugging difficult. It prevents you from easily distributing traffic based on actual load—you're locked into returning to the same instance regardless of its current utilization. It complicates your deployment process because instance replacements or rolling updates will disconnect users. And if you ever need to migrate to containerized workloads or serverless architectures, local state becomes a major obstacle.

The healthier approach is to externalize session state. AWS provides excellent options: ElastiCache for fast, in-memory session stores, or DynamoDB for more persistent, scalable session storage. When you externalize session state, stickiness becomes unnecessary. Any instance can handle any request because the session data isn't local—it's in a shared, highly available backing store.

Consider this practical scenario: You run an e-commerce platform with a shopping cart feature. If you store the cart in memory on the instance that handled the login request, you're fragile. Instance failures lose carts. Scaling operations disconnect users. Instead, store the cart in ElastiCache with the user's session ID as the key. Any instance can fetch the cart. Users experience seamless continuity even as instances come and go.

### When Stickiness Actually Makes Sense

That said, there are legitimate use cases for sticky sessions, though they're narrower than many assume. Stickiness genuinely helps when you have expensive, per-connection state that's genuinely hard to externalize—think WebSocket connections or long-polling scenarios where the server maintains a persistent connection to a client. In these cases, you need the same instance to handle all messages from that client because the connection itself is tied to that instance.

Another reasonable case is when you're retrofitting an older application that wasn't designed for distributed architectures, and you need a quick fix before a larger refactor. Stickiness can buy you time while you plan a migration to externalized session storage. It's a temporary band-aid, not a permanent solution.

There are also scenarios involving in-memory caching that benefit from stickiness, but it's not because you need stickiness—it's a side effect. If your application caches certain data in memory and the cache is expensive to warm up, requests to the same instance will hit the cache more often. But this is optimization, not correctness. Build your application assuming any instance might handle any request, then optimize for cache locality if profiling shows it matters.

### Configuration and Trade-offs

Let's walk through the practical configuration. In the AWS console, you navigate to your ALB target group, select the "Group level stickiness" tab, and enable it. You then choose between duration-based and application-based stickiness.

For duration-based, you set the stickiness duration in seconds. The default is 86,400 seconds (one day). The ALB generates the `AWSALB` cookie automatically.

For application-based, you enter the cookie name your application uses. The ALB will read this cookie and maintain affinity based on its value. Your application controls the cookie's TTL through the `Set-Cookie` header.

The key trade-off between the two: duration-based stickiness is simpler to implement (no application changes) but gives you less control over session lifecycle. Application-based stickiness requires your application to create a session cookie, but it respects your application's session timing logic.

There's also an important consideration around cookie scope. Cookies are browser-based constructs, so stickiness relies on the client sending the cookie back. If a client is a mobile app or an API consumer that doesn't preserve cookies, stickiness won't work at all. You'll need application-level session management or a service-to-service authentication mechanism.

### Impact on Load Distribution and Scaling

Here's where stickiness reveals its cost: it interferes with even load distribution. If one user has a session with 10 requests per minute and another has a session with 100 requests per minute, both are stuck on their respective instances. You can end up with lopsided load even if the underlying traffic is balanced.

More critically, stickiness complicates autoscaling. When your ALB decides to scale down due to low load and terminates instances, those terminations need to account for active sticky sessions. AWS can drain connections gracefully, but you'll still have a window where clients on the terminated instance get rerouted, breaking their sessions. If you've set stickiness duration to 7 days, clients might still try to reconnect to a non-existent instance for a long time.

This is why cloud-native architectures move away from stickiness. If session state is in DynamoDB or ElastiCache, autoscaling becomes straightforward—any instance can take any request. You get better resource utilization, faster scaling, and resilience to instance failures.

### Practical Architecture Patterns

Let's ground this in reality with a concrete pattern. Suppose you're building a web application with user authentication. Here's the stickiness-free approach:

User logs in to any ALB instance. The application verifies credentials against a database (or IAM, or Cognito). On successful login, the application creates a session record in ElastiCache with a TTL of 1 hour. It returns a session cookie to the browser containing a session ID (not the session data itself). The next request includes this cookie. Any instance retrieves the session from ElastiCache using the session ID from the cookie. The session is refreshed (TTL extended) on each request.

With this pattern, you don't need stickiness. You don't need to configure ALB affinity. You don't worry about instance failures or scaling events because session state is externalized and highly available. Your application is simpler, more resilient, and scales more easily.

If you're handling WebSockets, a different pattern applies. WebSockets maintain persistent connections, so a single client is tied to a single instance for the duration of the connection. In this case, stickiness (or more specifically, sticky load balancing to the initial connection handler) makes sense. But AWS ALB doesn't natively handle WebSocket protocol upgrades—you'd use a Network Load Balancer (NLB) for that scenario, which offers connection-based affinity at a lower level.

### Monitoring and Troubleshooting Stickiness

If you do enable stickiness, monitor it carefully. CloudWatch metrics won't directly tell you about sticky session affinity, but you can observe indirect signals. Look at target-level request distribution—if one or two targets are consistently handling disproportionate traffic despite similar response times and error rates, stickiness might be causing uneven load. Also monitor the number of requests hitting targets after those targets enter a draining state; high numbers suggest you have long-lived sticky sessions.

Application logs are your best friend here. If you're using application-based stickiness, verify that the cookie name is correct and that your application is actually setting it. If you're using duration-based stickiness, spot-check requests to confirm the `AWSALB` cookie is present and being honored.

When troubleshooting session loss (users getting logged out unexpectedly), don't assume stickiness is the culprit—it might be, but it could also be that your session store is failing, the session duration is too short, or the cookie isn't being preserved through your entire request flow.

### Conclusion

Sticky sessions on ALB are a tool that solves a real problem—the need to route a client to the same backend instance. But they solve it in a way that conflicts with modern distributed systems design. Duration-based stickiness via the `AWSALB` cookie is convenient and requires no code changes, while application-based stickiness gives you more control by leveraging your own session cookies. But both share the same fundamental limitation: they're brittle in the face of infrastructure changes.

The better architectural pattern—for nearly all modern applications—is to externalize session state to a shared, scalable store like ElastiCache or DynamoDB. This approach eliminates the need for stickiness entirely, improves your application's resilience, simplifies autoscaling, and enables you to build cloud-native systems that truly leverage AWS's strengths. Stickiness is a useful escape hatch for legacy applications or complex stateful protocols, but it shouldn't be your default. Design for statelessness, and your infrastructure becomes far more elegant and reliable.
