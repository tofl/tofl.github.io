---
title: "API Gateway Custom Domain Names and Certificates"
---

## API Gateway Custom Domain Names and Certificates

When you deploy an API with AWS API Gateway, you get a default endpoint that looks something like `d1234567890.execute-api.us-east-1.amazonaws.com`. While functional, this URL is neither memorable nor professional for production APIs. Custom domain names let you present your own branded domain—such as `api.example.com` or `myservice.example.com`—while leveraging API Gateway's robust infrastructure behind the scenes. Beyond aesthetics, custom domains are essential for building client trust, maintaining brand consistency, and managing API evolution without breaking client integrations.

This guide walks you through the complete process of attaching a custom domain to your API Gateway, understanding the architectural options available to you, securing your domain with certificates, and troubleshooting common gotchas that trip up developers in production.

### Understanding Domain Endpoint Types

API Gateway offers two distinct types of custom domain endpoints, each with different characteristics, performance profiles, and certificate requirements. Your choice here fundamentally shapes how your API is delivered globally.

An edge-optimized domain sits behind CloudFront, AWS's global content delivery network. When you create an edge-optimized custom domain, API Gateway automatically provisions a CloudFront distribution that caches requests at edge locations around the world. This means your API benefits from reduced latency for clients distributed globally—requests are intercepted at the nearest CloudFront edge and only route to your API's actual region if the response isn't cached. The tradeoff is that edge-optimized domains incur CloudFront data transfer costs and add a small amount of additional latency for cache misses, especially for dynamic API responses that rarely cache effectively.

A regional domain points directly to your API Gateway in a specific AWS region without any CloudFront caching layer. If your API is deployed in `us-west-2`, your regional endpoint serves traffic directly from that region. This is ideal when your client base is concentrated in one geographic area, when you need minimal latency variance, or when you want to avoid CloudFront's billing and caching complexity. Regional domains are also simpler to debug because you're not reasoning about CloudFront's caching behavior.

There's also a third, less common option: HTTP APIs with regional domains, which provide a lightweight alternative to REST APIs with potentially lower costs and simpler configuration—though they lack some advanced features like request/response transformation and API caching that REST APIs offer.

For a typical production scenario, ask yourself: Are my clients distributed globally or concentrated in one region? Do I need caching at the edge, or am I serving mostly dynamic content? Edge-optimized domains are the default choice for public APIs expecting worldwide traffic, while regional domains suit internal APIs, region-specific services, or when you want to minimize architectural complexity.

### The Certificate Foundation: ACM and Its Constraints

Every custom domain must be secured with an SSL/TLS certificate. AWS Certificate Manager (ACM) is your primary tool here, and it integrates seamlessly with API Gateway. ACM allows you to request public certificates for free, making it far more cost-effective than purchasing certificates from third-party vendors.

Here's the critical constraint that catches many developers: **certificates for edge-optimized domains must reside in the `us-east-1` region**. This is not arbitrary—CloudFront, which powers edge-optimized domains globally, only reads certificates from `us-east-1`. If you attempt to create an edge-optimized domain with a certificate in `eu-west-1`, you'll encounter an error.

For regional domains, your certificate can live in the same region as your API Gateway, simplifying management when your entire stack is colocated.

To request a certificate through ACM, you navigate to the ACM console, click "Request a certificate," and specify your domain name. ACM supports both exact domain names (e.g., `api.example.com`) and wildcard certificates (e.g., `*.example.com`). Wildcard certificates are handy if you plan to host multiple subdomains under the same apex—`api.example.com`, `webhooks.example.com`, and `internal.example.com` all work under a single `*.example.com` certificate.

ACM validates ownership via email or DNS. Email validation requires you to click a link in an automated message sent to registered domain contacts, while DNS validation requires you to add a CNAME record to your domain's DNS configuration. DNS validation is preferred in production because it's automatable and non-expiring—once validated, certificate renewal happens automatically without manual intervention.

After validation completes, your certificate enters the `ISSUED` state. ACM handles renewal automatically before expiration, so you're not managing certificate lifecycles manually. This is a massive operational win compared to purchasing certificates elsewhere.

### Creating a Custom Domain in API Gateway

Once you have a certificate ready, the actual custom domain creation is straightforward. Within the API Gateway console, navigate to "Custom domain names" and click "Create custom domain name."

You'll be prompted for several key inputs. First, the domain name itself—enter the fully qualified domain you want to use, such as `api.example.com`. Next, choose your endpoint type: edge-optimized or regional. If you select edge-optimized, ensure your certificate is in `us-east-1`. If regional, select the region where your certificate and API reside.

Then, specify the certificate. For edge-optimized domains, you'll see certificates from `us-east-1`; for regional domains, you'll see certificates in the current region. Select the certificate that matches your domain.

Finally, and this is important, you'll need to associate your custom domain with one or more APIs and stages. This is where base path mappings come in. A base path mapping is a routing rule that directs traffic hitting your custom domain to a specific API and stage. For example, you might map `/` to your `production` stage of your main API, and `/webhooks` to a separate webhooks API in its `live` stage.

If you're hosting everything under a single custom domain, you'll typically set up one mapping with `/` as the base path. This means all traffic to `api.example.com/*` routes to your API's default stage. More complex setups might use multiple mappings if you're aggregating several APIs under one domain.

### DNS Configuration: CNAME and Route 53 Aliases

After creating your custom domain in API Gateway, you're halfway there. The domain exists in AWS, but DNS on the public internet still doesn't know to route `api.example.com` traffic to your API Gateway.

API Gateway provides a target domain—for edge-optimized domains, this is a CloudFront URL like `d1234567890.cloudfront.net`; for regional domains, it's an API Gateway regional endpoint like `d1234567890.execute-api.us-east-1.amazonaws.com`. You must create a DNS record pointing your custom domain to this target.

If your domain registrar supports CNAME records and your domain is not the apex (like `api.example.com` rather than `example.com`), create a CNAME pointing your custom domain to the API Gateway target. For example:

```
api.example.com  CNAME  d1234567890.execute-api.us-east-1.amazonaws.com
```

However, if you manage your domain through Route 53 (AWS's DNS service), or if you need to alias the apex domain itself, use Route 53 alias records instead. Alias records are Route 53-specific constructs that let you point to AWS resources without the limitations of traditional CNAME records. An alias record pointing to an API Gateway custom domain looks like this in the Route 53 console: target the custom domain resource (not the underlying CloudFront or execute-api endpoint directly), and Route 53 handles the rest.

After creating your DNS record, propagation takes a few minutes. You can verify propagation using command-line tools:

```bash
dig api.example.com
nslookup api.example.com
```

Once DNS resolves to your API Gateway endpoint, HTTPS requests to `https://api.example.com` should work, and your browser will validate the certificate without warnings because the certificate's Common Name or Subject Alternative Name includes your domain.

### Securing with WAF (Web Application Firewall)

Custom domains often become the target of malicious traffic—bots probing for vulnerabilities, credential stuffing attacks, or simple denial-of-service attempts. AWS WAF (Web Application Firewall) integrates directly with API Gateway to provide request filtering.

When you create or edit a custom domain, you can associate a WAF web ACL. This web ACL contains rules that inspect incoming requests and decide whether to allow, block, or count (monitor) them. Common rules include IP reputation lists that block known malicious sources, rate-based rules that throttle clients making excessive requests, and pattern-matching rules that block requests containing SQL injection payloads or other known attack signatures.

WAF is particularly valuable for API Gateways exposed to the public internet. For internal APIs accessed only from known IP ranges, WAF might be less critical, though a simple IP whitelist rule adds minimal overhead and significant security value.

### Mutual TLS: Bidirectional Certificate Validation

Standard HTTPS secures communication between client and server, with the server proving its identity via certificate. Mutual TLS (mTLS) goes further: both parties exchange and validate certificates. This is essential for APIs where you need absolute certainty about the client's identity—think partner integrations, inter-service communication in highly secured environments, or regulated industries like finance or healthcare.

API Gateway supports mTLS through client certificate validation. To enable this, you configure a truststore—essentially a bundle of CA certificates you trust. When a client connects, API Gateway verifies that the client's certificate was signed by a trusted CA in your truststore.

Setting up mTLS involves several steps. First, create or obtain client certificates signed by a CA you control or trust. This could be your organization's internal CA or a public CA. Next, in the API Gateway custom domain settings, upload your truststore bundle (a PEM-encoded file containing trusted CA certificates). Then, configure whether client certificates are required or optional, and whether API Gateway should ignore certificate expiration or other validity issues (useful during testing, dangerous in production).

When clients attempt to connect, they must present a valid certificate from a CA in your truststore. If validation fails, API Gateway rejects the connection. This adds friction—clients must manage certificates—but provides authentication without relying on API keys, passwords, or OAuth tokens, which can be leaked or compromised.

### Base Path Mappings and API Versioning

Base path mappings deserve deeper exploration because they unlock sophisticated API organization patterns without requiring multiple custom domains.

Imagine you're running two APIs under `api.example.com`: a v1 API in a `legacy` stage and a v2 API in a `production` stage. You could create two separate custom domains, but that's inefficient. Instead, create base path mappings:

- Map `/v1` to your v1 API, `legacy` stage
- Map `/v2` to your v2 API, `production` stage

Now, clients access `https://api.example.com/v1/users` for the legacy endpoint and `https://api.example.com/v2/users` for the production endpoint. Both live under one custom domain and certificate, reducing operational complexity.

Base path mappings can also version a single API. If you have one API with multiple stages (dev, staging, production), you might map `/dev`, `/staging`, and `/prod` paths to the respective stages. This lets clients choose their environment without changing the base domain.

One crucial detail: the base path mapping is a prefix. If you map `/v1` to an API, requests to `/v1/users/123` include `/users/123` in the request path sent to your Lambda functions or backend integrations. Make sure your resource paths don't duplicate the base path, or you'll end up with unintended URLs like `/v1/v1/users`.

### Troubleshooting Certificate and Domain Issues

Several common errors plague developers setting up custom domains. Let's walk through the most frequent ones and their resolutions.

**Certificate not found or invalid**: This usually means you've selected a certificate in the wrong region. Remember: edge-optimized domains require certificates from `us-east-1`, and regional domains require certificates in the same region as your API. If you created a certificate in `eu-west-1` for an edge-optimized domain, you'll see an error. The fix is to request a new certificate in `us-east-1` or switch to a regional domain in `eu-west-1`.

**Certificate validation failed**: Your certificate might not be validated yet. Check the ACM console and confirm the certificate's status is `ISSUED`. Pending certificates show `PENDING VALIDATION`. If stuck here, check your email for validation messages, or review the DNS CNAME records that ACM provided for DNS validation.

**DNS not resolving**: After creating your custom domain and DNS record, wait a few minutes for propagation. Use `dig` or `nslookup` to verify resolution. If DNS still doesn't resolve, confirm your DNS record is correctly configured at your registrar or Route 53. For Route 53 alias records, ensure you've selected the correct custom domain resource, not a generic CNAME record.

**SSL certificate name mismatch errors**: Clients connect to `api.example.com`, but the certificate is issued for `different.example.com`. This happens when your certificate's Common Name or Subject Alternative Names don't include your actual domain. Request a new certificate with the correct domain names, or use a wildcard certificate like `*.example.com`.

**Intermittent HTTPS failures**: For edge-optimized domains, CloudFront caches some aspects of certificate configuration. If you recently updated your certificate or domain settings, CloudFront's cache might be stale. Wait a few minutes or manually invalidate the CloudFront distribution through the CloudFront console.

**403 Forbidden after domain creation**: You've set up DNS and the domain resolves, but requests return 403. Check that you've created a base path mapping. Without a mapping, API Gateway doesn't know which API and stage to route custom domain traffic to. Add a mapping with `/` as the path and your desired API and stage.

### Performance and Cost Considerations

Choosing between edge-optimized and regional domains carries financial implications worth understanding. Edge-optimized domains incur CloudFront data transfer costs—typically around $0.085 per GB egressed. If your API serves large payloads globally, this can add up. Regional domains avoid CloudFront entirely, reducing variable costs, though they don't benefit from edge caching.

From a performance perspective, edge-optimized domains reduce latency for geographically distributed clients because CloudFront pops (points of presence) are closer to end users than your API's home region. For clients in the same region as your API, the benefit is minimal or non-existent. Regional domains with clients in the same region often outperform edge-optimized variants because they bypass CloudFront's proxy overhead.

For cost-optimized setups serving a single region, regional domains are clearly better. For global APIs where reduced latency matters, edge-optimized domains justify the CloudFront costs, especially if responses are cacheable (though most dynamic APIs cache poorly).

API Gateway itself charges per million requests, independent of endpoint type. Custom domain creation and DNS management add no direct charges, though Route 53 queries for alias records incur minimal costs (typically cents per month). ACM certificates are free for use with AWS services like API Gateway, which further reduces the total cost of ownership compared to third-party certificate vendors.

### Deployment Patterns and Best Practices

In production, establish a naming convention for your custom domains. Many organizations use a pattern like `api-{environment}.example.com`—`api-dev.example.com`, `api-staging.example.com`, `api-prod.example.com`. This provides clear visual separation and prevents accidental traffic to the wrong environment.

For teams, automate custom domain creation through infrastructure-as-code (IaC) tools like CloudFormation or Terraform. Hardcoding domain names in console clicks is error-prone and untrackable. An IaC template for a custom domain captures the domain name, certificate ARN, endpoint type, and base path mappings in version-controlled code, making changes auditable and repeatable.

Consider DNS failover and disaster recovery. If your primary API becomes unavailable, can you quickly point your custom domain elsewhere? Route 53's failover routing policies let you specify primary and secondary API endpoints, automatically switching if health checks fail. This is overkill for many APIs but essential for mission-critical services.

Test your certificate renewal process before production. ACM handles renewal automatically, but you should verify that renewed certificates propagate correctly and don't introduce service interruptions. Many certificate-related outages stem from renewal failures that went unnoticed.

### Conclusion

Custom domains transform API Gateway from a functional tool into a professional, branded service. By understanding endpoint types, managing certificates through ACM, configuring DNS properly, and leveraging base path mappings, you gain the ability to present a polished API surface while maintaining operational simplicity behind the scenes.

The interplay between certificate location constraints, CloudFront's global reach, and DNS configuration might seem complex initially, but the pattern becomes intuitive with hands-on practice. Start with a regional domain in your home region if you're new to custom domains—it's simpler and reduces variables while you learn. Once comfortable, experiment with edge-optimized domains for geographically distributed clients and mTLS for sensitive integrations.

As your APIs grow and evolve, well-configured custom domains become invisible infrastructure—your clients simply see a reliable, branded endpoint, unaware of the certificate management, CloudFront distribution, or regional routing happening behind the scenes. That's the goal: letting your API's functionality shine while handling the plumbing professionally.
