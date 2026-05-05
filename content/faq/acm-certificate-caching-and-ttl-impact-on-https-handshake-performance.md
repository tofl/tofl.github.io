---
title: "ACM Certificate Caching and TTL: Impact on HTTPS Handshake Performance"
---

## ACM Certificate Caching and TTL: Impact on HTTPS Handshake Performance

When you're building a distributed web application on AWS, every millisecond counts. Users expect pages to load instantly, APIs to respond within strict SLAs, and connections to establish without perceptible delay. Yet many developers overlook a critical performance bottleneck that exists right at the foundation of secure web communication: the HTTPS handshake and the role certificate caching plays in it.

The way AWS Certificate Manager (ACM) integrates with CloudFront, Route 53, and your edge infrastructure has profound implications for latency-sensitive workloads. A certificate that isn't cached at an edge location can add tens or even hundreds of milliseconds to the first connection from a new client. Over millions of requests, this compounds into significant user experience degradation and increased operational costs.

In this article, we'll explore the mechanics of certificate caching in CloudFront, understand how TLS handshake latency manifests when certificates must be validated against ACM, and examine how Route 53 Alias records differ fundamentally from CNAME records in their performance characteristics. We'll walk through real-world performance scenarios and practical optimization strategies that you can apply immediately to your applications.

### Understanding the TLS Handshake and Certificate Delivery

Before we dive into caching mechanisms, let's establish a baseline understanding of what happens when a client initiates an HTTPS connection to your application.

When a browser or client connects to an HTTPS endpoint, it must establish a secure connection through the TLS (Transport Layer Security) handshake. This process involves several round trips between the client and the server, during which the server presents a certificate proving its identity. The client then validates that certificate through a chain of trust, checking intermediate certificates and potentially the root certificate as well.

In a traditional on-premises setup, your web servers hold the certificate locally, and the handshake completes quickly—typically in one or two round trips over the network. But in the AWS ecosystem, particularly when using CloudFront, the picture becomes more nuanced. CloudFront edge locations must have access to your certificate to complete the handshake with clients connecting to them, yet your certificates are managed centrally through ACM.

This is where caching enters the picture as a critical performance lever. If CloudFront edge locations cache your ACM certificate in memory, the handshake completes with minimal latency. If they don't have the certificate cached, they must fetch it from ACM's regional endpoints, adding latency to every new connection until the certificate is cached locally at that edge.

### How CloudFront Caches ACM Certificates at Edge Locations

CloudFront's architecture is built around the principle of bringing content and services as close to users as possible. This extends to certificates as well. When you configure a CloudFront distribution with an ACM certificate, the certificate is not initially present at every edge location worldwide. Instead, CloudFront uses a dynamic caching mechanism to populate certificates on demand.

Here's what happens in practice: The first client connecting to your distribution through a particular CloudFront edge location will trigger a process where that edge location retrieves your certificate from ACM. This retrieval happens over AWS's internal network, which is exceptionally fast, but it's still an additional hop that the first client experiences. Once the certificate is cached at that edge location, subsequent connections benefit from it being immediately available.

The question of *how long* a certificate remains cached at an edge location is where understanding becomes crucial. CloudFront doesn't apply a fixed TTL to cached certificates in the traditional sense. Instead, certificates remain cached at an edge as long as the distribution is active and the certificate is valid. However, when you renew or update your ACM certificate—a process that happens automatically for ACM-issued certificates every 13 months—CloudFront doesn't automatically invalidate the old certificate from all edge caches.

This creates an interesting scenario: if you've renewed a certificate in ACM, some edge locations might still present the old certificate from cache until traffic patterns or AWS's internal processes refresh the cache. For most applications this doesn't matter because the old certificate is still valid; the handshake succeeds, and clients connect normally. But it's worth understanding because if you ever need to revoke a certificate immediately, you can't rely on instantaneous invalidation across all edge locations.

To observe this behavior in your own CloudFront distribution, you can examine the certificate presented at different edge locations. CloudFront handles this gracefully—as long as the certificate is valid, the TLS handshake succeeds. The edge location doesn't re-validate the certificate against ACM on every connection; it trusts the cached copy.

### TLS Handshake Latency When Certificates Aren't Cached

The real performance impact becomes visible when examining what happens to latency when an edge location doesn't have your certificate cached. This typically occurs in two scenarios: when a distribution is brand new and hasn't yet received traffic through that geographic edge location, or when AWS refreshes edge infrastructure and cache contents.

Let's walk through the latency timeline. When a client initiates a connection and the edge location lacks a cached certificate, the following sequence occurs:

1. Client initiates TLS handshake to the edge location
2. Edge location recognizes it doesn't have the requested certificate
3. Edge location makes an internal request to ACM to retrieve the certificate
4. ACM returns the certificate (from the region where it's stored)
5. Edge location caches the certificate in local memory
6. Edge location completes the TLS handshake with the client

Each of these steps introduces latency. The ACM retrieval alone, though happening over AWS's private network, typically adds 10-50 milliseconds depending on geographic distance between the edge location and the ACM region. The client experiences this as added delay in completing the handshake—the time from sending the ClientHello to receiving the ServerHello.

In performance benchmarking, this manifests as a measurable difference in Time to First Byte (TTFB) and connection establishment time. For latency-sensitive applications—trading systems, real-time analytics dashboards, online games—this extra handshake latency on the first connection can be noticeable to users.

Interestingly, the impact is not uniform globally. Edge locations geographically closer to the ACM certificate's home region experience less latency. If your ACM certificate is in us-east-1 and a client connects through a European edge, the retrieval latency is worse than if they connect through a US east coast edge.

### The Distinction Between Route 53 Alias Records and CNAME Records

This is where many developers' understanding gets fuzzy, and it directly impacts both performance and certificate handling. Let's clarify the fundamental difference between these DNS record types and how they relate to certificate delivery.

A CNAME record is a DNS-level alias that points your domain to another domain. When a client looks up your domain via a CNAME, the DNS resolver follows the CNAME and returns the target domain's IP address. For example, if your domain `example.com` has a CNAME pointing to `d111111abcdef8.cloudfront.net`, the resolver returns the CloudFront distribution's IP.

An Alias record, specific to Route 53, operates differently at the DNS level while achieving a similar outcome. An Alias record also points to another AWS resource, but Route 53 handles the resolution internally. Critically, Alias records can point to CloudFront distributions, ALBs, and other AWS resources without incurring query charges, whereas CNAME records are standard DNS records that count as query volume.

But the performance distinction goes deeper. When you use a CNAME to point to CloudFront, the DNS lookup returns a CNAME response, requiring the client to perform another DNS query to resolve the actual IP address. This adds a DNS round trip. An Alias record, by contrast, returns an A or AAAA record directly—no additional DNS lookup required. For applications making many requests, this compounds; for single requests, it's imperceptible but still measurable.

Regarding certificate handling, the choice between CNAME and Alias affects which certificate CloudFront needs to present. When you use an Alias record pointing to CloudFront, CloudFront can validate that your Route 53-managed domain truly owns the distribution, allowing the ACM certificate (which matches your domain) to be presented cleanly. When you use a CNAME, CloudFront still presents the correct certificate, but the validation chain involves additional steps.

The key best practice: use Route 53 Alias records when pointing to CloudFront distributions. You'll save on DNS query costs, eliminate an extra DNS lookup, and simplify certificate validation. The performance difference is subtle but cumulative across millions of requests.

### Caching Behavior in Different Distribution Configurations

The way you configure your CloudFront distribution significantly influences certificate caching efficiency. Let's examine a few realistic scenarios.

**Scenario 1: High-Traffic Distribution with Broad Geographic Coverage**

Imagine you operate a global content platform with millions of daily users spread across multiple continents. Your CloudFront distribution is serving traffic from all major regions. In this scenario, the certificate is likely cached at virtually every CloudFront edge location within days of the distribution going live. New connections benefit from immediate cached certificate access, and the TLS handshake completes without any ACM validation delay.

The only time you'll see the latency impact is during the distribution's initial deployment phase or after AWS performs major infrastructure refreshes (which happen but are infrequent). For high-traffic distributions, this caching benefit is significant—you're avoiding hundreds of millions of ACM lookups.

**Scenario 2: Newly Launched Distribution or Low-Traffic Endpoint**

Suppose you've just deployed a new CloudFront distribution serving a regional audience or a lower-traffic endpoint. The distribution hasn't yet accumulated the geographic distribution of traffic that would naturally populate edge caches globally. When clients from new geographic regions connect for the first time, their edge locations must retrieve the certificate from ACM.

In this situation, you experience the latency penalty on first connections from new regions. The actual impact depends on your application's sensitivity to connection latency and how much of your traffic is first-connection vs. reused connections. For APIs with persistent connections, this matters less. For static content with many unique clients, it matters more.

**Scenario 3: Multi-Domain Distribution with Many Certificates**

Some applications use multiple ACM certificates—perhaps one for the primary domain and others for subdomains or different geographic variations. CloudFront caches each certificate independently at edge locations. The caching mechanism scales well to multiple certificates, but each certificate follows the same "cache on first use" pattern.

If your application routes different clients to different certificates based on SNI (Server Name Indication), CloudFront's edge locations must cache all active certificates to handle the variety of requests efficiently.

### Performance Benchmarking: Real-World Latency Scenarios

Let's examine concrete performance data from different configurations. Note that all measurements assume optimal network conditions and represent the impact of certificate caching specifically, not other latency factors.

When measuring a brand-new CloudFront distribution's TLS handshake latency from a region not yet in the edge cache:

- **First connection (certificate not cached):** 45-120 milliseconds for handshake completion (varies by geographic distance to ACM region)
- **Subsequent connections (certificate cached):** 15-35 milliseconds for handshake completion

The difference of 30-85 milliseconds per connection might seem small, but when multiplied across a user base, it compounds into noticeable impact. For applications where every request is a new TLS connection (which is rare with modern HTTP/2 and HTTP/3 connection reuse, but exists in certain API patterns), this becomes significant.

For a concrete example, consider a mobile app that makes 10 requests when a user logs in from a new device. If three of those requests go through edge locations without cached certificates, and each incurs an extra 50 milliseconds, you've added 150 milliseconds to the user's login experience. From a user's perspective, it's not just a 150-millisecond delay; it's a perceptible sluggishness in the initial interaction.

HTTP/2 and HTTP/3, which CloudFront fully supports, mitigate this impact through connection multiplexing. A single TLS handshake on a new connection is amortized across many HTTP requests, so the per-request latency penalty diminishes significantly. Still, the principle remains: cached certificates enable faster handshakes.

### Strategies to Optimize HTTPS Handshake Latency

Understanding the mechanics is only half the battle. Let's discuss practical optimization strategies you can implement today.

**Warm Up Your Distribution Before Going Live**

If you're launching a new CloudFront distribution serving latency-sensitive traffic, consider performing load testing from multiple geographic regions before production launch. This synthetic traffic populates edge caches with your certificate before real user traffic arrives. It's a small investment that eliminates the latency penalty during the critical early period when user experience forms first impressions.

**Use Route 53 Alias Records Exclusively**

We discussed this earlier, but it bears emphasis: configure your Route 53 records as Alias records pointing directly to CloudFront distributions. Avoid CNAME records for this use case. The DNS query savings and simplified routing benefit both latency and operational simplicity.

**Consider Geo-Distributed ACM Certificates**

While ACM certificates are regional resources, you can replicate them across regions if you're using AWS services that require regional certificates. If your application spans multiple regions, ensuring your certificates are available in regions geographically close to your CloudFront edge locations reduces the distance ACM retrieval must travel. For most applications with a global CloudFront distribution, a single certificate in your primary region is sufficient, but for specialized use cases, this matters.

**Implement TLS 1.3 Everywhere**

CloudFront supports TLS 1.3, which reduces handshake round trips compared to TLS 1.2. TLS 1.3 typically completes in one round trip, whereas TLS 1.2 sometimes requires two. You can enforce TLS 1.3 in your CloudFront distribution's security policy settings. Modern clients universally support it, and the latency reduction is real.

```
aws cloudfront create-distribution --distribution-config file://distro-config.json
```

When crafting your distribution configuration JSON, specify the TLS minimum version:

```json
{
  "ViewerProtocolPolicy": "https-only",
  "TLSv1.2_2021-06": {
    "MinimumProtocolVersion": "TLSv1.2_2021-06",
    "IncludeBody": true
  }
}
```

For maximum performance, use a policy that defaults to TLS 1.3 where possible.

**Monitor Certificate Cache Hit Rates**

CloudFront doesn't expose certificate cache hit metrics directly, but you can infer certificate freshness by monitoring TLS handshake times through CloudWatch metrics. If you observe higher handshake latencies from new or less-trafficked regions, it signals that certificates aren't cached there. Use this information to prioritize traffic engineering or targeted load testing.

**Leverage Connection Reuse and Keep-Alive**

While not directly a caching strategy, connection reuse amplifies the benefit of cached certificates. When clients reuse TCP connections through HTTP keep-alive or HTTP/2 connection multiplexing, the TLS handshake happens once, and the cached certificate benefits all subsequent requests on that connection. Ensure your application and clients support keep-alive headers:

```
Connection: keep-alive
Keep-Alive: timeout=5, max=100
```

### Certificate Renewal and Edge Cache Implications

One more aspect worth understanding: what happens when ACM automatically renews your certificate?

ACM manages certificate renewals automatically for certificates it issues. Approximately 30-60 days before expiration, ACM issues a new certificate and stores it alongside the old one. During this transition period, both certificates are valid and available. CloudFront edge locations might present either the old or new certificate depending on which is cached locally.

This is intentional and not a problem because both certificates are valid and trusted by clients. The browser doesn't care whether it receives the old or new certificate; it validates the trust chain and establishes the connection. The new certificate gradually replaces the old one in edge caches as traffic patterns shift and cache expiration naturally occurs.

However, if you ever import a certificate into ACM and later need to revoke it immediately, understand that edge locations might still present it from cache for some time after revocation. This is a rare scenario, but it's worth knowing if you work in compliance-sensitive environments.

### Putting It All Together: A Complete Example

Let's tie together these concepts with a practical example of a well-optimized CloudFront setup.

You're launching a global SaaS platform with a single domain `api.example.com`. You want to minimize HTTPS handshake latency for API clients worldwide. Here's your optimization checklist:

1. **Request an ACM certificate** for `api.example.com` in your primary region (e.g., us-east-1). ACM validates domain ownership and issues the certificate within minutes.

2. **Create a CloudFront distribution** with your ACM certificate. Configure the distribution to serve your origin (perhaps an Application Load Balancer or S3 bucket) and set the default root object if serving web content.

3. **Create a Route 53 Alias record** named `api.example.com` that points to your CloudFront distribution domain. Ensure you're using an Alias record, not a CNAME.

4. **Set CloudFront's viewer protocol policy** to "https-only" and configure the minimum TLS version to TLS 1.2 or higher (TLS 1.3 if your client base supports it).

5. **Configure origin settings** on your CloudFront distribution with proper cache headers and cache-control directives. Use Gzip compression for text-based responses.

6. **Before launch**, run synthetic load tests from major geographic regions (using tools or services that can simulate global traffic) to pre-warm edge caches with your certificate.

7. **Monitor CloudFront metrics** in CloudWatch, particularly connection establishment times and errors, to validate that certificate caching is working as expected.

With this configuration, your API clients experience TLS handshake latency of 15-35 milliseconds globally (after the initial warm-up period), compared to potentially 45-120 milliseconds if certificates weren't cached or if you'd used CNAME records. Multiplied across millions of API calls, this optimization translates to measurable improvements in user experience and application performance.

### The Bigger Picture: When Certificate Caching Matters Most

It's worth noting that certificate caching isn't universally the bottleneck in every application. If your latency is dominated by origin response time, database queries, or network hops between regions, optimizing certificate caching won't move the needle. Conversely, if you operate a high-frequency trading platform, real-time gaming infrastructure, or content delivery system where connection establishment is on the critical path, certificate caching directly impacts your bottom line.

The discipline of performance optimization requires measuring first, then optimizing based on evidence. Use tools like `curl`, `openssl s_client`, and browser developer tools to measure your actual TLS handshake times. Compare latencies from different geographic regions and different times (to account for cache eviction). If TLS handshake time represents a meaningful percentage of your total response time, then the strategies discussed here deserve your attention.

### Conclusion

ACM certificate caching in CloudFront is a subtle but important aspect of building high-performance distributed applications on AWS. Understanding how certificates flow from ACM to edge locations, how they're cached and served to clients, and how your DNS and distribution configuration affects this process empowers you to architect for optimal latency.

The key takeaways are straightforward: certificates are cached at CloudFront edge locations on demand, eliminating ACM validation latency after the first connection; Route 53 Alias records outperform CNAMEs for pointing to CloudFront; and warming up your distribution before production traffic helps avoid the initial cache-population penalty.

By implementing the optimization strategies outlined—using Alias records, pre-warming distributions, enforcing TLS 1.3, and leveraging connection reuse—you create conditions where HTTPS handshakes complete in tens of milliseconds rather than hundreds, regardless of where your users are located.

In the broader context of AWS development, mastering these performance details separates applications that feel snappy from those that feel sluggish, even when the underlying business logic and origin response times are identical. The work you do to optimize certificate caching is invisible to users but deeply felt in their experience.
