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