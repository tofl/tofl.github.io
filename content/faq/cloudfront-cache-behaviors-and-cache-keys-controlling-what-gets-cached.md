---
title: "CloudFront Cache Behaviors and Cache Keys: Controlling What Gets Cached"
---

## CloudFront Cache Behaviors and Cache Keys: Controlling What Gets Cached

Imagine you've deployed a web application behind Amazon CloudFront, expecting blazing-fast performance. Your first request loads quickly—the content is cached. But then something unexpected happens: identical requests from different users aren't hitting the cache. Or worse, requests are serving stale or incorrect data because CloudFront is grouping requests together that shouldn't be grouped. The culprit? Misconfigured cache behaviors and cache keys.

CloudFront's power lies not just in its ability to cache content, but in its granular control over *what* gets cached and *how* requests are matched against cached objects. This is where cache behaviors and cache keys become critical. Understanding these concepts is essential for optimizing performance, reducing origin load, and ensuring your application serves the right data to the right users. Let's explore how CloudFront makes these decisions and how you can leverage them effectively.

### Understanding Cache Behaviors and Path Patterns

At the heart of CloudFront's routing logic is the concept of cache behaviors. A CloudFront distribution can have multiple cache behaviors, and each one is tied to a specific path pattern. When a request arrives at CloudFront, it evaluates these patterns in order and applies the first matching behavior.

Think of cache behaviors as rules. You might have one behavior for `/api/*` endpoints, another for `/images/*` static assets, and a default behavior for everything else. Each behavior can have completely different settings—different cache TTLs, different forwarding rules, different compression settings, and different origin configurations.

The order matters tremendously. CloudFront evaluates path patterns from most specific to least specific (actually, from the order you define them), and uses the first match. If you have a behavior for `/api/users/*` and another for `/api/*`, the more specific one should come first. Otherwise, all `/api/users/*` requests would match the more general `/api/*` pattern instead.

Let's say you're configuring a distribution for a content site that serves blog posts, product images, and an API. You might define behaviors like this:

- Behavior 1: `/api/*` → forward to your API origin, minimal caching
- Behavior 2: `/images/*` → serve from a static S3 bucket, aggressive caching
- Behavior 3: `/` → serve from your web server origin, moderate caching

When a request for `/images/product-photo.jpg` comes in, CloudFront stops at Behavior 2 and applies those settings. A request for `/api/users/123` matches Behavior 1. Everything else falls through to the default behavior.

### The Cache Key: How CloudFront Decides Requests Are Equivalent

Here's the real magic: CloudFront uses something called a *cache key* to determine whether two incoming requests are asking for the same cached object. If two requests produce the same cache key, they're considered equivalent, and the second request hits the cached response from the first.

By default, the cache key is simply the URL. But CloudFront can be configured to include other values in the cache key: HTTP headers, query string parameters, and cookies. This is where things get nuanced.

Imagine you have a request for `example.com/product?id=123&sort=price`. The cache key by default is just that URL. The next request for the same URL hits the cache. But what if the next request is `example.com/product?id=123&sort=rating`? Different query string, different cache key, cache miss. That's intentional—the results might be different based on the sort parameter.

But here's the trap: if you're not careful, you can end up with cache keys that are *too specific*. For instance, if CloudFront includes the `User-Agent` header in the cache key, then a request from Chrome and a request from Firefox for the same URL become different cache keys. The cache hit ratio plummets. Conversely, if you're *too permissive* and don't include query strings you should, you might serve incorrect data.

### Legacy Forwarded Values vs. Modern Policies

For years, AWS CloudFront used the "forwarded values" approach. You'd configure which headers, query strings, and cookies to forward to the origin and separately decide which of those should be included in the cache key. This approach conflated two concerns: what to send to the origin and what to use for cache matching.

Today, AWS recommends using two distinct policies: the *Cache Policy* and the *Origin Request Policy*. These replace the legacy forwarded values configuration, offering clearer semantics and better security.

The **Cache Policy** controls what's included in the cache key and which values are cached. It answers the question: "What makes two requests different enough to deserve separate cache entries?" The Cache Policy specifies headers, query strings, and cookies that should factor into the cache key, plus the TTL behavior.

The **Origin Request Policy** controls what's forwarded to the origin but is *not* part of the cache key. It answers: "What does the origin need to know?" This might include authorization headers, custom headers with request metadata, or cookies needed for session management. These values go to the origin but don't affect whether a request hits the cache.

Let's work through an example. Suppose you have an API endpoint that returns user-specific data. The request includes a cookie with the user's session ID, and you need to forward that cookie to the origin so the origin knows which user made the request. However, you *don't* want the session ID in the cache key, because that would create a cache entry for every unique user—defeating the purpose of caching.

With the Cache Policy and Origin Request Policy:

- **Cache Policy**: Doesn't include the session cookie
- **Origin Request Policy**: Includes the session cookie for forwarding

With the old forwarded values approach, you'd toggle a checkbox and hope you got it right.

### Composing the Cache Key: What Gets Included

The cache key fundamentally consists of:

The **URL** is always the base. This includes the scheme (https://), domain, path, and any query strings that are configured to be included in the cache key.

**Headers** can be included selectively. Common examples include `CloudFront-Viewer-Country` (identifying where the request came from), `Accept-Language`, or `Accept-Encoding`. If your origin serves different content based on language preference, you'd include `Accept-Language` in the cache key so that French and English requests don't collide.

**Query strings** can be included in full or selectively. You might include some query parameters but not others. For example, a `utm_source` tracking parameter probably shouldn't affect the cache key, but an `id` parameter definitely should.

**Cookies** can be included selectively by name. If your application uses a cookie to track user preferences, you might include it; if it's just a tracking cookie, you probably shouldn't.

Here's a crucial insight: every value you include in the cache key reduces your cache hit ratio. If you include the `User-Agent` header, the same request from different browsers misses the cache. If you include the `CloudFront-Viewer-Country` header, every geographic region gets its own cache entry. This isn't always bad—sometimes you *want* different entries for different regions. But you're trading cache efficiency for freshness or personalization.

### AWS-Managed vs. Custom Policies

AWS provides several managed Cache Policies and Origin Request Policies that cover common scenarios. Understanding these is immensely helpful.

For static assets, the **CachingOptimized** managed policy is ideal. It caches aggressively, includes only the URL in the cache key (no headers or query strings), and doesn't forward most headers to the origin. This maximizes hit ratio for things like images, CSS, and JavaScript.

For APIs, you might use **CachingDisabled**, which sets a TTL of 0—essentially no caching. This ensures API responses are always fresh. Or, if you want some caching with API responses, you'd use a custom policy that carefully selects which query parameters and headers matter.

For APIs that vary by authorization, the **Managed-CachingDisabled** policy is often combined with an Origin Request Policy that forwards the `Authorization` header. Since caching is disabled, whether you include it in the cache key is moot, but you still need to send it to the origin.

Creating a custom policy gives you fine-grained control. You specify which headers, query parameters, and cookies to include, their respective TTLs, and whether to enable gzip compression. AWS CloudFront also includes some special headers it can add automatically, like `CloudFront-Viewer-Country`, which identifies the requester's geographic location—useful if your origin needs to customize responses by region.

### Static Assets: Maximize Cache Efficiency

For static content—images, CSS, JavaScript files—your goal is maximum cache efficiency and minimal origin load. This is where aggressive caching and minimal cache key composition shine.

Use the **CachingOptimized** managed Cache Policy or create a custom one that includes only the URL in the cache key and sets a long TTL (like 31536000 seconds, or one year). Don't include headers, query strings, or cookies unless you have a specific reason.

However, there's a caveat: what if you update a file? If you cache `app.js` for a year and then deploy a new version, CloudFront will still serve the old version from cache. The standard solution is to use versioned filenames. Instead of deploying `app.js`, you deploy `app-v2-abc123.js`. The filename includes a hash or version, so when you update the file, it has a different name and a different URL. New requests fetch the new file; old requests still hit the cache.

Many build tools handle this automatically. They generate versioned filenames and update your HTML to reference them. When paired with CloudFront, this approach gives you the best of both worlds: aggressive caching and fresh assets.

### API Endpoints: Balance Freshness and Performance

APIs are trickier. You need responses to reflect the current state of your backend, but you also want to reduce load and improve latency through caching.

For endpoints that return user-specific data, like `/api/user/profile`, you need the cache key to include something that differentiates users. This might be a `user-id` query parameter or a session cookie. But here's the problem: if you include that in the cache key, you get a separate cache entry per user, which defeats the purpose.

One approach is to not cache user-specific data at all. Use the **CachingDisabled** policy for such endpoints. The origin processes every request, ensuring users always see their own data.

Another approach is to use short TTLs for endpoints where staleness is acceptable. If you cache the `/api/products` endpoint with a 60-second TTL, most requests hit the cache, but it's fresh enough for most use cases. Include only the URL in the cache key (or relevant query parameters like `category`), so requests are grouped efficiently.

For endpoints with query parameters, consider which ones actually affect the response. If you have `/api/products?category=electronics&utm_source=newsletter`, the category affects the response but the utm_source doesn't. Include only category in the cache key (or better yet, include query strings selectively if your Cache Policy supports it). This way, requests with different tracking parameters still share the cache.

Some organizations use a technique called *cache-key headers*. The origin includes custom headers in its response, and CloudFront is configured to include those headers in the cache key. This gives the origin fine-grained control over cache behavior without requiring client-side changes.

### Origin Request Policy: What the Origin Needs

While the Cache Policy determines what's cached, the Origin Request Policy determines what's forwarded to the origin. These are separate concerns, and understanding the distinction prevents a common mistake.

Suppose your origin needs the `Authorization` header to validate requests, but you don't want it in the cache key (to prevent separate cache entries per user). You'd use an Origin Request Policy that includes the `Authorization` header, but a Cache Policy that doesn't.

Another example: your origin might need a custom header like `X-Original-URL` to understand the original request that CloudFront received. If CloudFront rewrites URLs or strips query strings, the origin needs this header to process requests correctly. You'd add it to the Origin Request Policy.

CloudFront provides managed Origin Request Policies too. **AllViewerAndWhitelistCloudFrontHeaders** forwards all viewer headers plus specific CloudFront headers like `CloudFront-Viewer-Country`. **CustomOrigins** is more restrictive, forwarding only essential headers.

A critical point: headers included in the Origin Request Policy but not explicitly mentioned in the Cache Policy are *not* part of the cache key. They're forwarded to the origin for processing, but they don't affect cache matching. This is powerful. Your origin can use this information to customize responses without fragmenting your cache.

### Real-World Configuration Example

Let's put it together with a practical scenario: a web application with static assets, a REST API, and user-specific data.

For `/static/*` (images, CSS, JavaScript):
- Cache Policy: **CachingOptimized** or a custom policy with URL-only cache key and 1-year TTL
- Origin Request Policy: **CustomOrigins** (minimal headers)
- Origin: S3 bucket or static CDN

For `/api/public/*` (data that doesn't vary per user):
- Cache Policy: Custom policy with query strings in the cache key, 5-minute TTL
- Origin Request Policy: Includes authorization if needed, any custom headers
- Origin: API server

For `/api/user/*` (user-specific data):
- Cache Policy: **CachingDisabled** (no caching)
- Origin Request Policy: Includes Authorization header, user identity headers
- Origin: API server

For `/` and other HTML pages:
- Cache Policy: Custom policy with URL only, 1-hour TTL (or shorter if content updates frequently)
- Origin Request Policy: Custom, including any headers the origin needs
- Origin: Web server

Each behavior targets a different path pattern, and each has policies tuned to its specific needs. Static assets are cached aggressively, user-specific data isn't cached, and public API data is cached with moderate TTLs.

### Monitoring and Optimization

After deploying your cache behaviors, monitor their effectiveness. CloudFront provides metrics like cache hit ratio, origin latency, and byte distribution. A low cache hit ratio for static assets suggests your cache key is too specific or your TTL is too short. High latency might mean you're forwarding unnecessary headers or not caching when you should be.

Use CloudFront's real-time logs to dig deeper. You can see exactly which requests hit the cache and which missed, along with the cache key composition. Over time, you'll refine your policies based on actual traffic patterns.

Also, remember that cache invalidation is always an option. If you need to remove cached content before its TTL expires—say, because you've deployed a critical update—you can invalidate specific paths. However, invalidation takes time to propagate and should be used sparingly. It's better to design your caching strategy to avoid needing frequent invalidations.

### Key Takeaways

CloudFront's cache behaviors and cache keys are powerful tools for controlling exactly what gets cached and how. Cache behaviors route requests to different configurations based on path patterns, while cache keys determine whether two requests should share a cached response. The modern approach using Cache Policies and Origin Request Policies cleanly separates the concern of what's cached from what's forwarded to the origin, making configurations more maintainable and secure.

For static assets, prioritize cache efficiency with long TTLs and minimal cache key composition. For APIs, be intentional about what varies the response and design your cache key accordingly. Use AWS-managed policies as starting points, then customize as needed for your specific use case. Monitor your cache hit ratio and adjust based on actual traffic.

Mastering these concepts transforms CloudFront from a simple CDN into a sophisticated layer that dramatically improves application performance while reducing origin load. Whether you're serving static sites or complex applications, thoughtful cache behavior and cache key configuration is where that transformation begins.
