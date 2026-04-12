---
title: "39. CloudFront"
type: docs
weight: 2
---

## CloudFront

CloudFront is AWS's Content Delivery Network (CDN). The core problem it solves is simple: if your application's origin server sits in `us-east-1` and a user requests a large image from Tokyo, that request travels halfway around the world and back. CloudFront fixes this by caching your content at **edge locations** close to your users, so subsequent requests are served locally — slashing latency and reducing the number of requests that ever reach your origin.

Beyond performance, CloudFront also absorbs traffic spikes at the edge, provides a single HTTPS endpoint in front of heterogeneous origins, and integrates natively with AWS security services like WAF and Shield.

### Edge Locations and Points of Presence

CloudFront's global network is made up of **edge locations** (where content is cached and served) and **regional edge caches** (a mid-tier cache between edge locations and your origin, holding less-popular content longer). Together these form CloudFront's **Points of Presence (PoPs)** [🔗](https://aws.amazon.com/cloudfront/features/). When a user makes a request, CloudFront routes it to the nearest PoP via Anycast. If the content is cached there (a *cache hit*), it's returned immediately. If not (a *cache miss*), CloudFront forwards the request to your origin, caches the response, and serves it.

### Origins

An **origin** is the source of truth CloudFront fetches from on a cache miss. Supported origin types include:

- **S3 buckets** — the most common pattern for static assets (images, JS, CSS, SPAs)
- **Application Load Balancers** — for dynamic web applications
- **EC2 instances** — less common; the instance must be publicly reachable
- **Custom HTTP endpoints** — any HTTP/HTTPS server, including on-premises

You can configure **multiple origins** on a single distribution and route traffic between them using cache behaviors.

### Cache Behaviors and Path Patterns

A **cache behavior** defines how CloudFront handles requests that match a given URL path pattern. Every distribution has a default cache behavior (`*`), and you can add ordered rules before it. For example:

- `/api/*` → forward to an ALB origin, bypass caching, forward all headers
- `/static/*` → forward to S3, aggressive caching, strip query strings
- `*` → default catch-all

Within a cache behavior you control: which origin to use, whether to forward query strings/cookies/headers to the origin (these affect caching), allowed HTTP methods, and the TTL settings. Full reference: [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-values-specify.html#DownloadDistValuesCacheBehavior)

### TTL and Cache Invalidation

CloudFront respects standard HTTP cache headers (`Cache-Control: max-age`, `Expires`) sent by your origin to determine how long to cache an object. You can also override these at the cache behavior level by setting **minimum, default, and maximum TTL** values.

When you need to remove content before it expires — say, after deploying a new version of a file — you submit a **cache invalidation** [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Invalidation.html). You specify one or more paths (e.g., `/index.html` or `/static/*`) and CloudFront purges the cached copies across all edge locations. Invalidations are free for the first 1,000 paths per month, then charged per path. A better long-term strategy is **cache busting via versioned filenames** (e.g., `app.v2.js`), which avoids invalidation costs entirely.

### Restricting S3 Origins: OAC vs OAI

When your origin is an S3 bucket, you almost never want the bucket to be publicly accessible. CloudFront provides two mechanisms to ensure only CloudFront can read from S3:

- **Origin Access Identity (OAI)** — the legacy approach. A virtual CloudFront user is granted `s3:GetObject` via a bucket policy. Still functional but no longer recommended.
- **Origin Access Control (OAC)** — the current recommended approach [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html). OAC uses IAM's Signature Version 4 signing, supports SSE-KMS encrypted buckets, and works with all S3 regions including newer ones. Prefer OAC for all new distributions.

With OAC configured, your S3 bucket policy allows `s3:GetObject` only when the request comes from your specific CloudFront distribution.

### Geo-Restriction

You can **allowlist or blocklist** countries using CloudFront's built-in geographic restriction [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/georestrictions.html). When a blocked user hits an edge location, CloudFront returns a `403 Forbidden` before the request ever reaches your origin. This is useful for compliance or licensing requirements (e.g., a streaming service that can only distribute content in certain regions).

### Signed URLs and Signed Cookies

For private content — paid video streams, user-specific documents, pre-release software — you need to control *who* can access your cached objects. CloudFront provides two mechanisms:

- **Signed URLs** — grant access to a **single specific file**. The URL includes a signature, an expiration time, and optionally an IP restriction. Ideal for individual file downloads or cases where the client doesn't support cookies.
- **Signed Cookies** — grant access to **multiple files** (e.g., all assets under `/premium/*`) without changing individual URLs. Better for streaming media or protecting entire sections of a site.

Both are signed with either a **CloudFront key pair** (legacy, root account) or a **key group** (recommended, IAM-manageable) [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PrivateContent.html).

### Running Code at the Edge: Lambda@Edge and CloudFront Functions

CloudFront lets you execute code during the request/response lifecycle, without routing traffic back to your origin. There are two options:

- **CloudFront Functions** [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-functions.html) — lightweight JavaScript that runs at the edge location itself. Sub-millisecond execution, extremely low cost. Limited runtime (no network calls, no file system). Use for: URL rewrites/redirects, header manipulation, simple A/B testing, cache key normalization.
- **Lambda@Edge** [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-at-the-edge.html) — full Lambda functions (Node.js or Python) that run at **regional edge caches**. Supports network calls, larger payloads, longer execution. Use for: JWT validation, dynamic origin selection, personalization, generating responses from scratch.

Both intercept one or more of four **event hooks**: viewer request, origin request, origin response, viewer response. CloudFront Functions can only run on viewer request/response. Lambda@Edge can run on all four.

| | CloudFront Functions | Lambda@Edge |
|---|---|---|
| Trigger | Viewer req/res | All 4 hooks |
| Runtime | JS only | Node.js, Python |
| Max execution | 1 ms | 5–30 s |
| Network access | No | Yes |
| Cost | ~6× cheaper | Standard Lambda pricing |

### HTTPS and Custom SSL Certificates

CloudFront enforces HTTPS at the edge. You can require HTTPS between viewers and CloudFront, between CloudFront and your origin, or both. For a custom domain (e.g., `cdn.example.com`), attach an ACM certificate — it must be provisioned in **`us-east-1`** regardless of where your origin is, since CloudFront is a global service [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-requirements.html).

### Price Classes

CloudFront edge locations span three price tiers. A **price class** lets you trade off global coverage against cost:

- **Price Class All** — all edge locations worldwide, lowest latency globally
- **Price Class 200** — excludes the most expensive regions (parts of South America, Australia)
- **Price Class 100** — only the cheapest regions (North America, Europe)

If your users are exclusively in North America and Europe, Price Class 100 avoids paying for edge locations you'll never use [🔗](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PriceClass.html).

{{< qcm >}}
[
{
"question": "A company serves static assets from an S3 bucket through CloudFront. After deploying a new version of their JavaScript bundle, users are still receiving the old cached version. What is the MOST cost-effective long-term strategy to ensure users always get the latest assets?",
"answers": [
{
"answer": "Submit a cache invalidation for /static/* after each deployment.",
"isCorrect": false,
"explanation": "Invalidations work but become costly at scale. After the first 1,000 paths per month, each path is charged. This is not the most cost-effective long-term approach."
},
{
"answer": "Use versioned filenames (e.g., app.v2.js) for each deployment.",
"isCorrect": true,
"explanation": "Cache busting via versioned filenames means each new file has a unique URL, so CloudFront always fetches and caches the new version without any invalidation cost."
},
{
"answer": "Set the TTL to 0 in the cache behavior for all static assets.",
"isCorrect": false,
"explanation": "Setting TTL to 0 disables caching entirely, which defeats the purpose of CloudFront and significantly increases origin load and latency."
},
{
"answer": "Set a very short Cache-Control max-age header on every S3 object.",
"isCorrect": false,
"explanation": "Short TTLs reduce the effectiveness of caching and increase origin requests, increasing both latency and cost compared to versioned filenames."
}
]
},
{
"question": "A developer needs to restrict access to an S3 bucket so that only CloudFront can read from it. The bucket uses SSE-KMS encryption. Which mechanism should the developer use?",
"answers": [
{
"answer": "Origin Access Identity (OAI)",
"isCorrect": false,
"explanation": "OAI is the legacy approach and does not support SSE-KMS encrypted S3 buckets. It is no longer recommended for new distributions."
},
{
"answer": "Origin Access Control (OAC)",
"isCorrect": true,
"explanation": "OAC is the current recommended approach. It uses IAM Signature Version 4 signing, supports SSE-KMS encrypted buckets, and works with all S3 regions including newer ones."
},
{
"answer": "A bucket policy that allows public s3:GetObject access",
"isCorrect": false,
"explanation": "Making the bucket publicly accessible removes the protection layer entirely, exposing the content to direct access outside of CloudFront."
},
{
"answer": "An IAM role attached to the CloudFront distribution",
"isCorrect": false,
"explanation": "CloudFront distributions do not have IAM roles attached to them. Access to S3 is controlled via OAC or OAI mechanisms, not IAM roles on the distribution."
}
]
},
{
"question": "A streaming platform must block users from certain countries due to content licensing agreements. When a blocked user attempts to access content, what does CloudFront return?",
"answers": [
{
"answer": "301 Moved Permanently",
"isCorrect": false,
"explanation": "A 301 redirect is not used for geo-restriction. CloudFront does not redirect blocked users; it denies the request."
},
{
"answer": "403 Forbidden",
"isCorrect": true,
"explanation": "CloudFront's geo-restriction returns a 403 Forbidden response to users in blocked countries, before the request ever reaches the origin."
},
{
"answer": "404 Not Found",
"isCorrect": false,
"explanation": "A 404 is returned when a resource does not exist, not when access is geographically blocked. The correct response for an access denial is 403."
},
{
"answer": "503 Service Unavailable",
"isCorrect": false,
"explanation": "A 503 indicates that the service is temporarily unavailable, not that access has been deliberately blocked based on geography."
}
]
},
{
"question": "Which of the following are valid origin types for a CloudFront distribution? (Select THREE)",
"answers": [
{
"answer": "Amazon S3 bucket",
"isCorrect": true,
"explanation": "S3 is the most common origin type for CloudFront, used extensively for static assets like images, JavaScript, CSS, and single-page applications."
},
{
"answer": "Application Load Balancer",
"isCorrect": true,
"explanation": "ALBs are a supported origin type, typically used for dynamic web applications that sit behind CloudFront."
},
{
"answer": "Amazon RDS database",
"isCorrect": false,
"explanation": "RDS is a relational database service and cannot be used as a CloudFront origin. CloudFront origins must be HTTP/HTTPS endpoints or S3 buckets."
},
{
"answer": "Custom HTTP/HTTPS server (on-premises)",
"isCorrect": true,
"explanation": "CloudFront supports any HTTP/HTTPS server as a custom origin, including servers hosted on-premises outside of AWS."
},
{
"answer": "Amazon DynamoDB table",
"isCorrect": false,
"explanation": "DynamoDB is a NoSQL database and is not a valid CloudFront origin. It does not expose an HTTP endpoint that CloudFront can pull content from directly."
}
]
},
{
"question": "A developer wants to protect a paid video streaming section of their site (`/premium/*`) so that only authenticated subscribers can access it, without changing the URLs of individual video files. Which CloudFront feature should they use?",
"answers": [
{
"answer": "Signed URLs",
"isCorrect": false,
"explanation": "Signed URLs grant access to a single specific file and would require changing every video URL. They are better suited for individual file downloads."
},
{
"answer": "Signed Cookies",
"isCorrect": true,
"explanation": "Signed Cookies grant access to multiple files matching a pattern (e.g., /premium/*) without modifying individual URLs, making them ideal for protecting entire sections of a site like streaming libraries."
},
{
"answer": "Geo-restriction",
"isCorrect": false,
"explanation": "Geo-restriction blocks or allows access based on the user's country, not based on authentication status or subscription level."
},
{
"answer": "Cache behavior with no-cache headers",
"isCorrect": false,
"explanation": "Cache behavior TTL settings control caching, not access control. They do not authenticate or authorize users."
}
]
},
{
"question": "A team is deploying a CloudFront distribution with a custom domain `cdn.example.com` and needs to attach an SSL/TLS certificate from AWS Certificate Manager (ACM). In which AWS region must the certificate be provisioned?",
"answers": [
{
"answer": "The same region as the origin server",
"isCorrect": false,
"explanation": "ACM certificates used with CloudFront must be in us-east-1 regardless of where the origin is located, because CloudFront is a global service."
},
{
"answer": "us-east-1",
"isCorrect": true,
"explanation": "CloudFront requires ACM certificates to be provisioned in us-east-1 (N. Virginia). This is a hard requirement because CloudFront is a global service managed from this region."
},
{
"answer": "Any region where the distribution is deployed",
"isCorrect": false,
"explanation": "CloudFront distributions are global and not tied to a specific region. The ACM certificate must specifically be in us-east-1."
},
{
"answer": "The region closest to the majority of users",
"isCorrect": false,
"explanation": "The ACM certificate region is not determined by user geography. It must always be us-east-1 for use with CloudFront, regardless of where users are located."
}
]
},
{
"question": "A CloudFront distribution serves both an API (`/api/*`) and static files (`/static/*`). The team wants the API requests to bypass caching and forward all headers, while static files are cached aggressively. How should this be configured?",
"answers": [
{
"answer": "Create two separate CloudFront distributions, one for the API and one for static files.",
"isCorrect": false,
"explanation": "There is no need for separate distributions. CloudFront supports multiple cache behaviors on a single distribution with path pattern routing."
},
{
"answer": "Configure multiple cache behaviors with path patterns on a single distribution.",
"isCorrect": true,
"explanation": "Cache behaviors with path patterns (e.g., /api/* and /static/*) allow different caching policies, origins, and header forwarding rules on the same distribution."
},
{
"answer": "Use Lambda@Edge to detect the URL path and apply different cache settings at runtime.",
"isCorrect": false,
"explanation": "While Lambda@Edge can manipulate requests, using multiple cache behaviors is the native, simpler, and purpose-built solution for this routing requirement."
},
{
"answer": "Set Cache-Control headers on the origin for each path and rely solely on the default behavior.",
"isCorrect": false,
"explanation": "A single default behavior cannot apply different forwarding rules (e.g., forwarding all headers for /api/* but stripping them for /static/*). Multiple cache behaviors are required."
}
]
},
{
"question": "Which of the following use cases is BEST suited for CloudFront Functions rather than Lambda@Edge?",
"answers": [
{
"answer": "Validating a JWT token by calling an external authentication service",
"isCorrect": false,
"explanation": "CloudFront Functions cannot make network calls. JWT validation requiring an external service call must use Lambda@Edge, which supports network access."
},
{
"answer": "Rewriting URLs and normalizing cache keys at the viewer request stage",
"isCorrect": true,
"explanation": "CloudFront Functions are designed for lightweight, sub-millisecond tasks like URL rewrites and cache key normalization at the viewer request/response stage."
},
{
"answer": "Dynamically selecting an origin based on user profile data fetched from a database",
"isCorrect": false,
"explanation": "Fetching data from a database requires network access, which CloudFront Functions do not support. Lambda@Edge should be used for this."
},
{
"answer": "Generating a fully custom HTML response from scratch based on complex business logic",
"isCorrect": false,
"explanation": "Generating complex responses may require longer execution time and potentially network access, making Lambda@Edge more appropriate than the 1ms limit of CloudFront Functions."
}
]
},
{
"question": "A developer needs to run code that intercepts the response coming FROM the origin before it is cached and delivered to the viewer. Which event hooks support this? (Select TWO)",
"answers": [
{
"answer": "Viewer request",
"isCorrect": false,
"explanation": "The viewer request hook fires when CloudFront receives a request from a viewer, before checking the cache. It does not intercept the origin response."
},
{
"answer": "Origin request",
"isCorrect": false,
"explanation": "The origin request hook fires before CloudFront forwards a cache miss request to the origin. It does not intercept the response from the origin."
},
{
"answer": "Origin response",
"isCorrect": true,
"explanation": "The origin response hook fires after CloudFront receives a response from the origin but before caching it, allowing modification of the response before it is stored and delivered."
},
{
"answer": "Viewer response",
"isCorrect": true,
"explanation": "The viewer response hook fires before CloudFront returns the response to the viewer, allowing manipulation of headers or content in the final response."
}
]
},
{
"question": "A company's application has users exclusively in North America and Europe. They want to minimize CloudFront costs by avoiding paying for edge locations they will never use. Which Price Class should they select?",
"answers": [
{
"answer": "Price Class All",
"isCorrect": false,
"explanation": "Price Class All includes all edge locations worldwide, including expensive regions the company's users will never use, leading to unnecessary costs."
},
{
"answer": "Price Class 200",
"isCorrect": false,
"explanation": "Price Class 200 excludes only the most expensive regions like parts of South America and Australia but still includes more regions than necessary for a North America and Europe-only audience."
},
{
"answer": "Price Class 100",
"isCorrect": true,
"explanation": "Price Class 100 covers only North America and Europe — the cheapest regions — making it the right choice for a user base concentrated in those areas, minimizing cost while maintaining good coverage."
}
]
},
{
"question": "What is the role of regional edge caches in the CloudFront network?",
"answers": [
{
"answer": "They serve as the primary cache layer closest to end users.",
"isCorrect": false,
"explanation": "Edge locations are the cache layer closest to end users, not regional edge caches. Regional edge caches sit between edge locations and the origin."
},
{
"answer": "They act as a mid-tier cache between edge locations and the origin, holding less-popular content longer.",
"isCorrect": true,
"explanation": "Regional edge caches are a middle tier that retains content longer than individual edge locations, reducing the number of requests that need to reach the origin for less-frequently accessed content."
},
{
"answer": "They replace the origin server when it is unavailable.",
"isCorrect": false,
"explanation": "Regional edge caches are not a failover mechanism for origin outages. They are a caching tier, not a high-availability replacement for the origin."
},
{
"answer": "They handle HTTPS termination for custom SSL certificates.",
"isCorrect": false,
"explanation": "HTTPS termination and SSL certificate handling occur at edge locations, not at regional edge caches specifically."
}
]
},
{
"question": "A developer is comparing Signed URLs and Signed Cookies. Which scenario is BEST suited for Signed URLs?",
"answers": [
{
"answer": "Granting a subscriber access to an entire library of premium video files.",
"isCorrect": false,
"explanation": "When multiple files need to be protected without changing their URLs, Signed Cookies are the better fit, not Signed URLs."
},
{
"answer": "Allowing a user to download a single confidential report on a client that does not support cookies.",
"isCorrect": true,
"explanation": "Signed URLs are ideal for granting time-limited access to a single specific file, and they work even in environments where cookies are not supported."
},
{
"answer": "Protecting all assets under /member/* for logged-in users.",
"isCorrect": false,
"explanation": "Protecting a path-based group of files is the primary use case for Signed Cookies, not Signed URLs."
},
{
"answer": "Blocking users from specific countries from accessing any content.",
"isCorrect": false,
"explanation": "Country-based access control is handled by CloudFront's geo-restriction feature, not by Signed URLs or Signed Cookies."
}
]
},
{
"question": "How does CloudFront determine how long to cache an object when no TTL overrides are set in the cache behavior?",
"answers": [
{
"answer": "CloudFront always uses a fixed default TTL of 24 hours regardless of origin headers.",
"isCorrect": false,
"explanation": "CloudFront respects origin HTTP cache headers. The default TTL applies only when the origin does not send Cache-Control or Expires headers."
},
{
"answer": "CloudFront respects Cache-Control: max-age and Expires headers sent by the origin.",
"isCorrect": true,
"explanation": "CloudFront honors standard HTTP caching headers from the origin to determine object TTL. The cache behavior's minimum, default, and maximum TTL values can also override these headers."
},
{
"answer": "CloudFront caches objects indefinitely until a manual invalidation is submitted.",
"isCorrect": false,
"explanation": "CloudFront does not cache indefinitely by default. It follows TTL values from origin headers or cache behavior settings."
},
{
"answer": "CloudFront never caches objects unless TTL is explicitly configured in the cache behavior.",
"isCorrect": false,
"explanation": "CloudFront caches by default and uses origin headers to determine TTL. Explicit configuration is not required for caching to occur."
}
]
},
{
"question": "A Lambda@Edge function is needed to inspect and potentially modify a request before it is forwarded to the origin, but only on cache misses. Which event hook should be used?",
"answers": [
{
"answer": "Viewer request",
"isCorrect": false,
"explanation": "The viewer request hook fires on every request from the viewer, including cache hits, not only on cache misses."
},
{
"answer": "Origin request",
"isCorrect": true,
"explanation": "The origin request hook fires only when CloudFront is about to forward a cache miss to the origin, making it the right hook to inspect and modify requests that will reach the origin."
},
{
"answer": "Origin response",
"isCorrect": false,
"explanation": "The origin response hook fires after the origin has already returned its response. It does not intercept the request before it reaches the origin."
},
{
"answer": "Viewer response",
"isCorrect": false,
"explanation": "The viewer response hook fires just before CloudFront sends the response to the viewer. It cannot modify the request going to the origin."
}
]
},
{
"question": "Which of the following statements correctly differentiates OAC from OAI when restricting S3 access to CloudFront? (Select TWO)",
"answers": [
{
"answer": "OAC supports SSE-KMS encrypted S3 buckets, while OAI does not.",
"isCorrect": true,
"explanation": "OAC uses Signature Version 4 and supports SSE-KMS encrypted buckets. OAI does not support SSE-KMS, which is one of the key reasons OAC is now preferred."
},
{
"answer": "OAI is the currently recommended approach for all new CloudFront distributions.",
"isCorrect": false,
"explanation": "OAI is the legacy approach. OAC is the current AWS recommendation for all new distributions."
},
{
"answer": "OAC works with all S3 regions including newer ones, while OAI had compatibility limitations.",
"isCorrect": true,
"explanation": "OAC was introduced partly to address region compatibility issues with OAI and supports all S3 regions, including those launched after OAI was created."
},
{
"answer": "OAI uses IAM Signature Version 4, while OAC uses a legacy signing mechanism.",
"isCorrect": false,
"explanation": "This is reversed. OAC uses IAM Signature Version 4. OAI uses an older virtual identity mechanism and does not use SigV4."
}
]
}
]
{{< /qcm >}}