---
title: "AppSync Caching: Per-Resolver vs Full-Request Caching Strategies"
---

## AppSync Caching: Per-Resolver vs Full-Request Caching Strategies

When you're building GraphQL APIs with AWS AppSync, performance becomes critical as your user base grows. One of the most powerful levers you have for optimization is server-side caching, backed by Amazon ElastiCache Redis. Understanding *when* to cache and *how* to cache is the difference between an API that feels snappy and one that crawls under load.

AppSync offers two distinct caching modes, each with different trade-offs, different configuration patterns, and different gotchas. In this article, we'll explore both per-resolver caching and full-request caching in depth, understand how to configure them properly, learn about the underlying Redis infrastructure, and discover common pitfalls that trip up developers.

### Understanding AppSync's Caching Architecture

AppSync's caching layer sits between your clients and your data sources. When a request comes in, AppSync can intercept it, check if a cached response exists, and return it without executing the resolver logic at all. This bypass is crucial: if you're calling a Lambda function that takes 500ms to execute, and you can return a cached result in 5ms, you've just achieved a 100x improvement in latency.

Behind the scenes, AppSync uses Amazon ElastiCache for Redis as its caching backend. This is important because it shapes how you think about capacity, encryption, and cost. You don't manage the Redis cluster directly—AWS handles that—but you do need to understand what's happening under the hood to configure it intelligently.

AppSync offers two caching strategies that differ fundamentally in what they cache and how they generate cache keys. Choosing between them isn't just a technical decision; it's a design decision that affects your entire API architecture.

### Per-Resolver Caching: Fine-Grained Control

Per-resolver caching operates at the resolver level, which means you define caching behavior for individual fields in your GraphQL schema. This is the more granular approach, and it gives you precise control over what gets cached and how.

When you enable per-resolver caching, you specify a cache key for each resolver. The cache key is a template that describes what parameters should uniquely identify a cached response. Think of it as the fingerprint of a request: if two requests have the same cache key fingerprint, they can share the same cached result.

A typical cache key configuration looks something like this:

```
$context.identity.sourceIp#$context.arguments.userId
```

This template says: "Create a cache key by concatenating the source IP of the requestor and the userId argument." Any two requests from the same IP with the same userId will hit the same cache entry. This is powerful because you're explicitly controlling what makes a response unique.

Here's another example that might be used for a public product listing resolver:

```
$context.arguments.categoryId#$context.arguments.sortBy
```

In this case, the category and sort order define uniqueness. The same category and sort, regardless of who's asking or from where they're asking, gets the same cached result.

The beauty of per-resolver caching is that it encourages you to think carefully about your data access patterns. You're not caching blindly; you're saying "these specific parameters matter for this resolver's result, and these other things don't."

### Full-Request Caching: Simplicity at Scale

Full-request caching takes a different approach entirely. Instead of defining cache keys per resolver, AppSync automatically generates a cache key from *all* the parameters in the GraphQL request: the query text, all the arguments, the variables, everything.

This means two requests are considered identical only if they are bit-for-bit the same. It's a much stricter matching criterion. The advantage is simplicity: you don't have to think about what should be in the cache key. The downside is that you might have fewer cache hits because fewer requests qualify as "identical."

Full-request caching is particularly useful for APIs where most queries are simple and don't have many variations. A mobile app that always requests the same set of fields for the logged-in user, for example, might see high cache hit rates with full-request caching.

### Comparing the Two Strategies

The fundamental difference comes down to specificity versus coverage. Per-resolver caching is specific and targeted; you're saying "this resolver's result depends on these parameters." Full-request caching is broad; you're saying "this entire request with all its parameters is a single cacheable unit."

Per-resolver caching typically yields higher cache hit rates because multiple different requests can share the same cached result at the resolver level. If you cache a "get user by ID" resolver at the per-resolver level, then a query asking for a user's profile and a query asking for a user's email can both benefit from the same cached user data (assuming the user ID is in the cache key).

Full-request caching is simpler to reason about and requires zero configuration, but each request must match exactly to get a cache hit. If one request includes a timestamp variable and another doesn't, they won't share a cache entry.

For most production GraphQL APIs, per-resolver caching is the better choice. It aligns with how GraphQL naturally structures data retrieval (resolver by resolver) and typically delivers better cache hit rates. Full-request caching is more appropriate for simpler APIs or for scenarios where you want caching without thinking about it at all.

### Configuring Per-Resolver Caching

Setting up per-resolver caching involves modifying your AppSync resolver definitions. In the AWS Management Console, you'd navigate to your API's resolvers, select the resolver you want to cache, and enable the caching toggle.

Once enabled, you'll see options for:

- **Caching enabled**: A simple toggle. Turn it on.
- **Cache key**: The template that generates the cache key, using the `$context` variable.
- **TTL (Time To Live)**: How long the entry should remain in the cache before expiring.

Here's a realistic example. Suppose you have a resolver for `Query.getUserProfile` that fetches user data from a database. You might configure it like this:

```
Cache key: $context.identity.accountId
TTL: 3600
```

This says: "Cache the result for 3600 seconds (one hour), and consider each account as a separate cache entry." Any request for a user profile from the same account will hit the cache.

Now consider a `Query.listProducts` resolver that's filtered by category:

```
Cache key: $context.arguments.categoryId#$context.arguments.page
TTL: 300
```

Here you're caching per category and page number, with a shorter 5-minute TTL because product listings change more frequently.

The cache key template language is quite flexible. You can access arguments, context variables, identity information, and even perform string operations. This flexibility is powerful but also a source of mistakes. A common pitfall is including something in the cache key that shouldn't be there, like a timestamp or a user preference that's specific to each user in a multi-tenant scenario.

### TTL Configuration and Cache Expiration

The TTL (Time To Live) value is critical. It's the number of seconds before an entry automatically expires and is removed from the cache. This is your primary lever for controlling data freshness.

There's no universal "correct" TTL. It depends entirely on your data and your tolerance for staleness. Product catalog data might reasonably have a 1-hour TTL; user profile data that rarely changes might have 24 hours; real-time stock prices shouldn't be cached at all.

One strategy is to categorize your resolvers by how frequently their underlying data changes:

- Static data (categories, reference data): 3600–86400 seconds (1–24 hours)
- Infrequently changing data (user profiles, product details): 300–3600 seconds (5 minutes–1 hour)
- Frequently changing data (inventory counts, scores): 30–60 seconds (or no caching)
- Real-time data: no caching

AppSync also allows you to set a default TTL at the API level, which applies to all resolvers that don't specify their own. This is useful for establishing a sensible baseline.

An important nuance: the TTL is not a promise of consistency. It's a time limit. If you set a 1-hour TTL, the entry will definitely expire within that hour, but it might be evicted sooner if the cache cluster runs out of memory.

### Cache Invalidation and Mutation Handling

Caching is only valuable if it actually reflects reality. When you update data—via a mutation, for example—you need a way to invalidate stale cache entries so that subsequent requests see the new data.

AppSync provides a cache invalidation API. When you execute a mutation, you can specify which cache entries should be invalidated. This is typically done in the mutation's resolver using the `$context.appsync.requestId` variable and AppSync's caching APIs.

In practice, you'd structure your mutation resolver like this (pseudocode in resolver mapping template):

```
## When a user updates their profile, invalidate their cached profile
$util.cache.del("user-profile#$context.arguments.userId")
```

The `$util.cache.del()` function removes an entry from the cache. You pass it the cache key (or a pattern of cache keys).

However, there's a complication: if your cache keys are complex or if you cache at multiple resolver levels, invalidation becomes intricate. This is a place where per-resolver caching's explicitness becomes both an asset and a liability. You need to know exactly which cache keys to invalidate, which requires coordination between your mutation and query resolvers.

Some developers handle this by maintaining a mental (or documented) map of which mutations affect which cached queries. Others use a convention where related resolvers use compatible cache keys, making invalidation patterns predictable.

### The Redis Infrastructure Behind AppSync Caching

AppSync manages the ElastiCache Redis cluster for you, but understanding its characteristics helps you configure caching effectively.

The Redis cluster has a maximum size limit. By default, AppSync provides you with a cache of appropriate size, but as your API grows and you cache more aggressively, you might hit capacity constraints. Redis evicts entries based on an eviction policy (typically LRU, least recently used) when memory fills up. This means even entries that haven't hit their TTL might be evicted if the cache runs out of space.

Monitoring your cache hit ratio is essential. AWS CloudWatch metrics show you how many requests resulted in cache hits versus misses. If your hit ratio is low (below 50% for a caching-friendly API), you might be configuring cache keys incorrectly, or your TTLs might be too short.

If you're consistently evicting entries due to memory pressure, you have limited options. AWS can increase the cache capacity for your AppSync API, but this incurs additional costs. Before requesting an upgrade, validate that your cache is actually being used effectively. A low hit ratio despite high cache capacity suggests a configuration issue rather than a capacity issue.

### Encryption and Security

AppSync's caching layer supports encryption both in transit and at rest, which is crucial if you're caching sensitive data.

Encryption in transit means the data traveling from AppSync to the Redis cluster is encrypted with TLS. This is enabled by default for AppSync's managed cache, and there's nothing you need to configure.

Encryption at rest means the data stored in Redis is encrypted on disk. For AppSync's managed cache, AWS handles this transparently. However, if you're concerned about the specific encryption keys or compliance requirements, you should verify the current AWS documentation for your region's encryption implementation.

The key security consideration isn't the encryption itself but rather what you choose to cache. Caching personally identifiable information (PII) or sensitive data requires extra thought. If you cache a user's email address with a cache key that's not unique to that user, you risk exposing that data in the cache to other users' requests.

For example, this cache key is dangerous:

```
$context.arguments.companyId
```

If you're caching user records with only the company ID as the key, multiple users from the same company will receive each other's cached data. The fix is to include the user ID in the key:

```
$context.arguments.companyId#$context.arguments.userId
```

This is a subtle but critical distinction that shows why understanding your cache keys is so important.

### Cost Implications

AppSync caching incurs costs based on the size of your cache cluster. A small cache (e.g., cache.r5.large) might cost roughly $100–200 per month, while larger instances scale from there.

The return on investment depends on your traffic patterns. If you're receiving 10,000 requests per second and your average resolver takes 500ms (database query, API call, etc.), caching could reduce your dependency on data source capacity proportionally to your cache hit ratio. If you achieve a 70% cache hit ratio, you're potentially reducing your database load by 70%, which could translate to significant savings on database costs or reserved capacity.

Many developers find that the cost of the cache cluster is quickly offset by the reduced load on their data sources. However, this isn't always the case. Low-traffic APIs might not justify the cache cost. Similarly, APIs with low cache hit rates (below 40%) are often not cost-effective to cache.

Before enabling caching for an API, rough out the economics: estimate your traffic, estimate your typical resolver latency, estimate your cache hit ratio, and then calculate whether the cache cost is worth the reduction in latency and data source load.

### Choosing Between Per-Resolver and Full-Request Caching

By now, the choice between the two strategies should be clearer, but let's be explicit about when each makes sense.

**Use per-resolver caching when:**

Your API has complex queries with multiple resolvers, and you want to cache granular pieces of data. You have multi-user or multi-tenant scenarios where different users request the same underlying data (different queries, same cache entries). You want fine-grained control over cache keys and invalidation. You expect relatively high cache hit rates and want to optimize for them.

**Use full-request caching when:**

Your API is simple and queries are highly repetitive (the same query with the same parameters is requested frequently). You don't want to spend time thinking about cache key configuration. You have a single-user or single-account API where cache key configuration is trivial. You're prototyping or building an MVP and want to add caching with minimal overhead.

For most production GraphQL APIs serving multiple users or complex queries, per-resolver caching is the right choice. It requires more upfront thought but pays dividends through higher cache hit rates and better control.

### Common Pitfalls and How to Avoid Them

Developers frequently encounter issues with AppSync caching. Here are the most common ones and how to sidestep them:

**Including dynamic values in the cache key.** If your cache key includes a timestamp, request ID, or any value that changes between requests, you'll never get cache hits. Always review your cache key templates to ensure they only include parameters that define logical uniqueness, not technical identifiers.

**Caching personalized data without proper key specificity.** This is the security pitfall mentioned earlier. If you're caching data that's specific to a user, and your cache key doesn't include the user ID, you're leaking data between users. Always include sufficient context in the cache key to prevent data leakage.

**Setting TTLs that are too short.** A 10-second TTL might feel safe from a freshness perspective, but it often doesn't yield meaningful cache benefits. Unless your data changes very rapidly, experiment with longer TTLs (5–60 minutes) for better hit rates.

**Not monitoring cache hit rates.** You can't optimize what you don't measure. Set up CloudWatch alarms for cache hit ratio. If it's below 50% for an API you expect to cache well, investigate.

**Forgetting to invalidate cache on mutations.** This is insidious because the system appears to work initially. You cache data, requests are fast, and then users notice they're seeing stale data after updates. Always implement cache invalidation for mutations that modify cached data.

**Over-caching to reduce database load.** While reducing database load is good, aggressively caching stale data just to minimize queries can harm user experience more than it helps. Balance latency improvements with freshness guarantees.

### Practical Example: Building a Product Catalog API

Let's walk through a realistic scenario: a product catalog API that serves both anonymous and authenticated users.

You have two primary queries: `listProducts` (filtered by category, paginated) and `getProductDetail` (by product ID). Both are read-heavy, cacheable, but have different access patterns.

For `listProducts`, you'd configure per-resolver caching like this:

```
Cache key: $context.arguments.categoryId#$context.arguments.pageSize#$context.arguments.pageNumber
TTL: 600 (10 minutes)
```

This caches the product list per category and page, with a 10-minute freshness window. Different users requesting the same category and page will all hit the same cache entry.

For `getProductDetail`, you'd use:

```
Cache key: $context.arguments.productId
TTL: 3600 (1 hour)
```

Product details change infrequently, so a longer TTL is appropriate. The cache key is just the product ID, meaning all users requesting the same product share the cached result.

When a product is updated (via the `updateProduct` mutation), your mutation resolver would invalidate both caches:

```
$util.cache.del("product-detail#$context.arguments.productId")
$util.cache.invalidateAll()
```

The first line invalidates a specific product. The second invalidates all product list caches (since we don't know which pages might contain that product). It's coarse but correct.

For this API, you'd expect cache hit rates of 60–80% depending on traffic distribution. If the same products are frequently viewed, and the same category pages are browsed repeatedly, caching is highly effective.

### Monitoring and Optimization

Once caching is live, your job isn't finished. Monitor these metrics:

**Cache hit ratio**: The percentage of requests served from cache. Aim for 50% or higher for most APIs. If it's lower, debug your cache key configuration.

**Cache eviction rate**: The number of entries evicted due to memory pressure. If this is high, you're caching more than your cache can hold, and you're not benefiting from most of the entries.

**Data source latency**: Compare the latency of requests that hit the cache (which should be 1–5ms) versus those that don't (which depend on your data source). A successful caching setup should show a dramatic difference.

**Cost per transaction**: Divide your cache cluster cost by the number of transactions served. If it's higher than the cost of the data source calls you saved, caching isn't economical.

Use CloudWatch dashboards to visualize these metrics. Set alarms for cache hit ratios below your target, and periodically review cache configurations to ensure they're still appropriate as your API evolves.

### Conclusion

AppSync caching is a powerful optimization tool, but it requires thoughtful configuration. Per-resolver caching offers the granular control and cache hit rates that most production APIs need, while full-request caching provides simplicity at the cost of coverage. Understanding your cache keys, setting appropriate TTLs, implementing invalidation for mutations, and monitoring cache behavior are the essentials of a well-tuned caching strategy.

The real power of caching emerges when it's aligned with your data access patterns. Take time to understand how your API is used, where the hot paths are, and what data is safe to serve stale. That investment in understanding will pay dividends in the form of faster APIs, reduced database load, and happier users.
