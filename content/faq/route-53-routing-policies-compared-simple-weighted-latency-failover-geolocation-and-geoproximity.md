---
title: "Route 53 Routing Policies Compared: Simple, Weighted, Latency, Failover, Geolocation, and Geoproximity"
---

## Route 53 Routing Policies Compared: Simple, Weighted, Latency, Failover, Geolocation, and Geoproximity

DNS is often treated as a solved problem—you point a domain name at an IP address and move on. But AWS Route 53, the managed DNS service, offers something far more powerful: the ability to route traffic based on dozens of different criteria. This capability turns Route 53 into a sophisticated traffic management tool that can drive application resilience, performance optimization, and advanced deployment patterns.

The routing policies available in Route 53 are the engine behind this flexibility. Each one solves a different problem, and understanding when to use each is essential for building robust applications on AWS. Whether you're implementing canary deployments, managing traffic across geographic regions, or handling failover scenarios, Route 53 routing policies are likely part of your solution. Let's dive deep into each policy, explore how they work in practice, and build a framework for choosing the right one.

### Understanding Route 53 Routing Policies at a Glance

Route 53 supports seven primary routing policies: Simple, Weighted, Latency-based, Failover, Geolocation, Geoproximity, and Multi-value answer. Before we examine each in detail, it helps to understand what these policies fundamentally do: they determine which resource (or set of resources) Route 53 returns when a DNS query arrives for your domain.

Some policies are deterministic—they follow predictable rules to select a destination. Others introduce randomization or geographic awareness. Some integrate tightly with health checks, while others don't use health checks at all. This diversity means you need mental models for when each policy excels and where it falls short.

### Simple Routing: When One Resource Is Enough

Simple routing is the straightforward choice: associate a single domain name with a single resource, and every DNS query returns the same answer. There's no health checking, no traffic distribution, no geographic awareness—just a direct mapping.

Simple routing works perfectly for non-critical applications, development environments, or when you have a single source of truth for a service. Imagine a company intranet or a low-traffic internal API. You point `intranet.company.internal` at your single EC2 instance, and that's that.

However, simple routing becomes problematic the moment you need resilience. If that single resource goes down, your domain becomes unreachable. There's no failover, no redirect—just broken DNS. For any production application, you'll almost certainly need something else.

One important limitation: simple routing doesn't support multiple resource records with the same name. If you try to create two A records for `example.com`, Route 53 will reject the second one. This is why simple routing genuinely is simple—it's a one-to-one mapping, nothing more.

### Weighted Routing: Distributing Traffic with Precision Control

Weighted routing lets you split traffic across multiple resources based on percentages you define. Assign each resource a weight (0 to 255), and Route 53 distributes queries proportionally to those weights.

Here's a concrete example: you're deploying a new version of your API to 10% of traffic while keeping 90% on the stable version. You create two weighted records for `api.example.com`: one pointing to your new deployment with weight 10, and one pointing to your current deployment with weight 90. Route 53 returns the new endpoint about 10% of the time and the current endpoint 90% of the time.

This is the pattern behind canary deployments. You gradually increase the weight of your new version as you gain confidence—maybe 10% on day one, 25% on day two, 50% on day three, then 100% when you're certain everything works. Throughout this process, most traffic safely goes to your proven version while a small percentage validates your changes.

Weighted routing pairs beautifully with health checks. You can attach a health check to each weighted record, and Route 53 only returns unhealthy endpoints if all records are unhealthy (a safety mechanism to prevent a complete failure). More commonly, if a record becomes unhealthy, Route 53 redistributes its traffic proportionally among the healthy records. If your canary deployment becomes unhealthy and you've given it weight 10, that 10% of traffic gets rerouted to your stable version.

The weights are relative, not absolute percentages. A weight of 50 paired with a weight of 50 gives each endpoint 50% of traffic. But weights of 100 and 100 also give each endpoint 50%. What matters is the ratio. This flexibility means you can use convenient numbers (like 1, 2, 5, 10) or precise values (like 37 and 63 if you need exact percentages).

One subtle point: when you have only one healthy weighted record, Route 53 returns it for every query, regardless of its weight. Weights only matter when multiple records are healthy.

### Latency-based Routing: Optimizing for Speed

Latency-based routing directs traffic to the resource that delivers the lowest network latency to the client's location. You define records in multiple AWS regions, and Route 53 measures latency from clients to each region, then routes each request to the fastest region.

This is invaluable when your application is deployed globally. A user in Sydney shouldn't route through a data center in Virginia if you have infrastructure in Australia. Latency-based routing handles this automatically, ensuring each client reaches the geographically closest (in terms of network latency) deployment.

Route 53 measures latency through health checks. Each region has a health check endpoint, and Route 53 continuously probes it to measure response times. It uses these measurements to build a latency profile and route accordingly. The actual routing decisions happen client-side in your DNS resolver's cache, but the intelligence comes from Route 53's latency measurements.

A critical distinction: latency-based routing doesn't care about geography in the traditional sense. It cares about network topology. A client in the UK might route to a US region if that region has better network connectivity due to peering arrangements or undersea cable quality. This is actually more sophisticated than simple geographic routing—it optimizes for actual user experience rather than assumed proximity.

Latency-based routing works with health checks, and you should use them. If a region becomes unhealthy, Route 53 stops routing traffic there and redistributes it to the next-best latency option. This means you get both performance optimization and automatic failover.

Here's where latency routing shines in practice: you have an API deployed to `us-east-1` and `eu-west-1`. Clients connect to `api.example.com`, and Route 53 automatically directs them based on latency. A user in Germany naturally routes to the EU region, while a user in New York naturally routes to the US region. Each gets the best possible experience without you managing any geographic logic in your application code.

### Failover Routing: Active-Passive High Availability

Failover routing implements a simple but powerful pattern: you designate one resource as primary and one or more as secondary (standby). Traffic goes to the primary, and if it fails its health check, traffic immediately switches to the secondary.

Think of it as a backup system. Your primary database is in one region, and you have a standby replica in another. All traffic goes to the primary, but if the primary goes down, Route 53 switches everything to the standby. The moment the primary recovers, traffic switches back.

Failover routing requires health checks—they're mandatory, not optional. You attach a health check to your primary record. Route 53 continuously monitors it. When it fails, Route 53 switches to the secondary record. This switch is automatic and typically happens within a minute (the health check interval plus a small buffer).

The secondary record also needs a health check if you have multiple secondaries, but more commonly you have one primary with a health check and one secondary without. If everything fails, Route 53 returns the secondary even if its health check fails.

Failover routing is synchronous and deterministic. If the primary is healthy, you always get the primary. Unlike weighted routing, there's no randomization or gradual transition. This makes it perfect for disaster recovery scenarios where you want a clear primary-secondary relationship.

A practical example: your application runs on an RDS database in `us-east-1` with a read replica in `us-west-2`. Your application always connects to a Route 53 DNS name `database.example.com`. Route 53 routes all traffic to the `us-east-1` endpoint because it's marked primary and its health check passes. The `us-east-1` database becomes unavailable, the health check fails, and Route 53 automatically switches to the `us-west-2` endpoint. Your application reconnects and continues working (though you'll need to promote the read replica to read-write in your database layer).

### Geolocation Routing: Routing by Geographic Location

Geolocation routing directs traffic based on where the DNS query originates. You define rules for continents, countries, or default locations, and Route 53 routes each query based on its source geography.

This is different from latency-based routing, which routes based on network speed. Geolocation routing cares about where the user is, not how fast the network is. You might use geolocation routing to comply with data residency regulations—European users must be served from European data centers, even if a US data center has better latency.

Setting up geolocation routing means creating records for different geographic locations. You might have one record set for `EU` (the Europe continent), another for `US` (the United States country), another for `GB` (Great Britain specifically), and a default record for everything else. Route 53 evaluates queries from most specific to least specific: if a query originates in the UK, it tries to match the `GB` rule first, then the `EU` rule, then the default.

Here's a concrete scenario: you're a SaaS provider subject to GDPR. You have infrastructure in Frankfurt, Ireland, and Virginia. You create geolocation rules that route all EU traffic to Frankfurt or Ireland, all US traffic to Virginia, and everything else to your default location. This ensures you never accidentally serve EU user data from a US data center.

Geolocation routing also requires health checks if you want automatic failover. You can mark a geolocation record as healthy or unhealthy based on its health check. If the EU rule becomes unhealthy, queries from the EU fall through to the default rule.

One nuance: Route 53 determines query origin by looking at the source IP address of the DNS request. This typically corresponds to the user's location, but not always. Users behind corporate proxies, VPNs, or using public DNS resolvers might appear to originate from different locations. This is why geolocation routing isn't perfect for performance optimization—use latency-based routing for that. Use geolocation routing for regulatory or policy-based decisions.

### Geoproximity Routing: Geographic Routing with Traffic Shifting

Geoproximity routing is geolocation routing with a twist: it routes based on geographic proximity to endpoints, and you can shift traffic between regions using a bias parameter.

Without bias, geoproximity routing directs queries to the endpoint closest to the query origin. You define endpoints with latitude and longitude coordinates (or AWS regions if your endpoints are in AWS), and Route 53 calculates distances and routes accordingly.

The real power emerges when you introduce bias. A bias parameter (ranging from -99 to 99) lets you shift traffic away from or toward a region. A positive bias expands a region's area of influence, pulling traffic from neighboring regions. A negative bias contracts it, pushing traffic to other regions.

Here's where this gets interesting: imagine you're running infrastructure in `us-east-1`, `us-west-2`, and `eu-west-1`. Without bias, each region serves traffic from its geographic area. But suppose `eu-west-1` has excess capacity while `us-east-1` is running hot. You add a positive bias to `eu-west-1`, expanding its geographic influence. Now, some US-East traffic that would normally route locally instead routes to the EU to balance load.

This is more sophisticated than weighted routing for geographic distribution. Weighted routing divides traffic by percentages without considering geography. Geoproximity with bias divides traffic geographically but with adjustable thresholds that let you shift traffic dynamically based on capacity, cost, or business needs.

The bias parameter is counterintuitive. A bias of +50 for the EU region doesn't mean "+50% traffic"—it expands that region's geographic boundary. The exact impact depends on relative positions and other regions' biases. Testing and monitoring are essential because the relationship between bias values and actual traffic percentages isn't linear.

Geoproximity routing also supports health checks, so you can handle regional outages by automatically redistributing traffic.

### Multi-value Answer Routing: Client-Side Load Balancing

Multi-value answer routing is a lesser-known but valuable policy: instead of returning a single answer, Route 53 returns multiple resource records in a single DNS response. The client's resolver or application then chooses among them (often randomly, implementing simple client-side load balancing).

You can have up to eight values in a multi-value answer. Create multiple multi-value records for the same domain name, attach health checks to each, and Route 53 returns all healthy records in each response.

This is useful when you want lightweight, distributed load balancing without complexity. A client that receives four healthy IP addresses for `api.example.com` can randomly choose one for each request, distributing load across all four. If you later add a fifth instance, Route 53 includes it in responses within a few seconds.

Multi-value answer routing doesn't guarantee even distribution—it depends on client behavior—but it's simpler than setting up an application load balancer for many small deployments. It works well for microservices architectures where multiple instances of a service exist and you want simple distribution.

One important constraint: multi-value answer routing returns random subsets of available records. If you have eight healthy records, a client might receive only four of them in a response. This is intentional, to prevent DNS response sizes from becoming unwieldy, but it means you can't guarantee all instances receive equal traffic. For predictable load balancing, use weighted or latency-based routing instead.

Health checks are important for multi-value answer routing. Unhealthy records are excluded from responses, so if an instance fails, it stops receiving traffic within one health check interval (typically 30 seconds).

### Health Checks: The Connective Tissue

Health checks deserve their own discussion because they're integral to several routing policies. A health check monitors an endpoint and reports whether it's healthy or unhealthy. Route 53 uses these health checks to make intelligent routing decisions.

Route 53 supports several types of health checks: HTTP/HTTPS checks that make actual HTTP requests to an endpoint, TCP checks that verify port connectivity, CloudWatch alarm checks that evaluate CloudWatch metrics, and calculated checks that combine other health checks with logic.

HTTP health checks are most common. You provide an endpoint like `http://api.example.com/health`, and Route 53 makes requests every 30 seconds (standard interval) or every 10 seconds (fast interval, which costs more). If the endpoint responds with a 2xx or 3xx status code, the check passes. Anything else fails.

Health checks can measure more than connectivity—they can verify application logic. A sophisticated health check might hit an endpoint that connects to your database and returns 200 only if the database is accessible. This way, a server that's running but can't reach the database won't receive traffic.

Here's a practical detail: Route 53 health checkers originate from multiple AWS regions and make parallel requests. By default, 3 out of 5 checkers must report healthy for an endpoint to be marked healthy. This prevents transient failures from causing unnecessary failover. You can adjust this threshold (the "failure threshold") when creating a health check.

Combined with routing policies, health checks enable sophisticated behavior. Failover routing with health checks gives you automatic disaster recovery. Weighted routing with health checks lets you implement canary deployments that automatically roll back if the canary becomes unhealthy. Geolocation routing with health checks ensures you never send traffic to unhealthy regional endpoints.

### Comparing Policies: Key Distinctions

Let's clarify some common confusions between policies that seem similar but work differently.

**Latency vs. Geolocation**: Latency-based routing optimizes for network speed based on actual measurements. Geolocation routing routes based on the client's geography regardless of network conditions. If you want every user to have the fastest possible experience, choose latency-based routing. If you need to enforce regulatory or policy-based geographic constraints, choose geolocation routing. They solve different problems.

**Weighted vs. Geoproximity**: Weighted routing distributes traffic by fixed percentages. Geoproximity distributes traffic by geographic location, with optional bias for dynamic adjustment. Weighted routing doesn't consider where the client is; geoproximity does. Use weighted routing for canary deployments and A/B testing. Use geoproximity when you want geographic distribution with flexibility to adjust based on capacity.

**Failover vs. Weighted with Health Checks**: Failover routing implements primary-secondary redundancy—traffic goes to primary until it fails, then switches to secondary. Weighted routing with health checks distributes traffic across multiple endpoints, removing unhealthy ones proportionally. Failover is all-or-nothing; weighted is gradual. Failover is for disaster recovery; weighted routing is for continuous load distribution.

**Multi-value Answer vs. Weighted**: Multi-value answer returns multiple IP addresses for the client to choose among. Weighted routing returns a single IP address (selected by Route 53). Multi-value is useful for simple client-side distribution; weighted routing gives you deterministic server-side control.

### Decision Framework: Choosing the Right Policy

So, which policy should you use? Here's a decision framework that walks through the most common scenarios:

**Are you running a single resource with no need for load balancing or failover?** Use Simple routing. It's the only case where simple routing is appropriate for production.

**Do you need to gradually roll out a new version while monitoring its stability?** Use Weighted routing. Set your canary version to 5 or 10 percent and gradually increase it as it proves stable. Health checks automatically roll back if the canary becomes unhealthy.

**Are you deployed to multiple AWS regions and want to optimize for user latency?** Use Latency-based routing. It measures actual network latency and routes each user to their fastest region. This is the best choice for global applications where performance matters.

**Do you have regulatory requirements to serve users from specific geographic regions?** Use Geolocation routing. GDPR, data residency laws, or content distribution rights might require that EU users are served from EU infrastructure. Geolocation routing enforces this.

**Do you need both geographic awareness and the ability to shift traffic based on capacity?** Use Geoproximity routing with bias. Start with geographic distribution, then adjust bias parameters to shift traffic when needed.

**Do you have a primary resource that might fail and a standby that should take over?** Use Failover routing. It's the clearest pattern for primary-secondary redundancy and disaster recovery.

**Do you have multiple instances and want simple client-side load balancing?** Use Multi-value answer routing. Return multiple healthy endpoints and let the client choose, perfect for distributed microservices.

This framework isn't exhaustive—you might combine policies or use them in layers—but it covers the vast majority of real-world scenarios.

### Practical Scenario: Putting It All Together

Let's walk through a realistic scenario that demonstrates multiple policies working together. You're building a global e-commerce platform with infrastructure in three AWS regions: `us-east-1`, `eu-west-1`, and `ap-southeast-1`.

Your architecture uses three Route 53 records:

Your main entry point `shop.example.com` uses latency-based routing to direct users to the closest region. Users in North America route to `us-east-1`, Europeans route to `eu-west-1`, and Asia-Pacific users route to `ap-southeast-1`.

Within `us-east-1`, your API endpoints use weighted routing. You're deploying a new API version and want to start with 5% traffic. You create two weighted records: new API version with weight 5, stable API version with weight 95. Both have health checks that monitor API responsiveness.

Your database uses failover routing. The primary database is in `us-east-1` with a read replica in `us-west-2` as standby. Your application layer queries `database.example.com`, which routes to the primary. If the primary fails its health check, Route 53 switches to the standby, and your application reconnects without code changes.

Your static CDN endpoints use geolocation routing for license compliance. You serve content from AWS CloudFront in most regions, but from a licensed third-party CDN in China because CloudFront doesn't operate there. Geolocation rules ensure Chinese users route to the licensed provider.

This hybrid approach gives you latency optimization for core traffic, gradual deployment for new features, disaster recovery for databases, and compliance for regulated regions—all managed through Route 53.

### Conclusion

Route 53 routing policies transform DNS from a simple directory service into a powerful traffic management system. Each policy solves specific problems: Simple for trivial cases, Weighted for gradual deployments, Latency for global performance, Failover for disaster recovery, Geolocation for compliance, Geoproximity for geographic load balancing with flexibility, and Multi-value for distributed client-side load balancing.

The key to using these policies effectively isn't memorizing their definitions—it's understanding the problems they solve and recognizing those problems in your applications. A canary deployment requires Weighted routing. A global application requires Latency-based routing. A regulated environment requires Geolocation routing. GDPR compliance with dynamic load shifting requires Geoproximity routing.

Most importantly, remember that health checks are the connective tissue that makes these policies intelligent. A routing policy without health checks is reactive; a routing policy with health checks is intelligent and self-healing. Invest time in setting up meaningful health checks that actually verify your application works, not just that the server is reachable.

Start with the simplest policy that solves your problem, then layer on sophistication as your needs grow. You'll find that Route 53's routing policies, when understood deeply and applied thoughtfully, enable resilience and performance patterns that would otherwise require expensive, complex infrastructure.
