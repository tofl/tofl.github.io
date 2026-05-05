---
title: "Alias Records vs CNAME Records in Route 53: Key Differences Explained"
---

## Alias Records vs CNAME Records in Route 53: Key Differences Explained

When you're setting up DNS for your AWS applications, Route 53 gives you powerful tools to direct traffic. But if you've ever wondered why you can't use a CNAME record for your root domain, or why AWS created something called an "Alias record" in the first place, you've hit on one of the most important distinctions in Route 53. Understanding the difference between these two record types will not only help you configure your infrastructure correctly—it'll also save you money and prevent some frustrating troubleshooting sessions.

Let's dive into what makes these records different, when to use each one, and why AWS chose to build something entirely new rather than just relying on standard DNS conventions.

### Understanding CNAME Records and Their Limitations

A CNAME (Canonical Name) record is part of the standard DNS specification and has been around for decades. It's straightforward: a CNAME record maps one domain name to another domain name. When a client queries a CNAME record, the DNS server responds with the canonical name, pointing the client toward the actual target.

For example, you might create a CNAME record that says `www.example.com` should resolve to `example.com`. Or in an AWS context, you could point `api.example.com` to `my-load-balancer-12345.us-east-1.elb.amazonaws.com`. The mechanics are simple and universally supported.

However, CNAME records have a critical limitation that often catches developers off guard: **you cannot create a CNAME record at the zone apex (the root domain)**.

The zone apex is the bare domain name itself—in this case, `example.com` without any prefix. This restriction exists because of how DNS standards work. The zone apex must contain certain mandatory record types, most importantly the Start of Authority (SOA) and Name Server (NS) records. If you pointed the apex to another domain using a CNAME, it would conflict with these required records and break your DNS setup entirely.

This creates a real problem in practice. What if you want your bare domain `example.com` to point to your load balancer or CloudFront distribution? With standard CNAME records, you're stuck. You'd have to force users to navigate to `www.example.com` instead—not ideal for user experience or branding.

### Introducing Alias Records: AWS's Solution

This is where Alias records come in. AWS created Alias records as a Route 53–specific extension to DNS that solves this exact problem. An Alias record allows you to map a domain name to an AWS resource directly within Route 53, and crucially, it works at the zone apex.

The key insight is that an Alias record isn't a standard DNS record type—it's a Route 53 feature. When you query an Alias record, Route 53 doesn't respond with a domain name like a CNAME would. Instead, Route 53 itself resolves the target resource and returns the actual IP address directly to the client. This is a meaningful distinction in how the resolution mechanism works.

### Why the Resolution Mechanism Matters

Let's walk through what happens when a client queries each record type.

When a client queries a CNAME record:

1. The client sends a DNS query for `api.example.com`
2. Your DNS resolver contacts Route 53, which responds with the CNAME target (e.g., `my-load-balancer.elb.amazonaws.com`)
3. The client's resolver then makes a *second* DNS query for `my-load-balancer.elb.amazonaws.com`
4. Route 53 responds with the actual IP address
5. The client connects to that IP address

This two-step process works, but it's less efficient and requires an extra DNS lookup.

When a client queries an Alias record:

1. The client sends a DNS query for `example.com`
2. Route 53 detects that this is an Alias record and immediately resolves the target resource to get its current IP address
3. Route 53 returns the IP address directly to the client
4. The client connects to that IP address

Notice the difference? With an Alias record, Route 53 does the heavy lifting internally. The client receives the final IP address in a single lookup. This is faster and more efficient.

### AWS Resources Supported by Alias Records

One of the best aspects of Alias records is that they work specifically with AWS resources. This makes sense because Route 53 can query AWS service APIs to determine the current IP addresses of your resources—something it cannot reliably do for arbitrary external domains.

Alias records support:

**CloudFront distributions**: Perfect for directing your root domain to a CloudFront distribution hosting your static content or your entire web application. Since CloudFront is global, this enables performance optimizations across regions.

**Application Load Balancers and Network Load Balancers**: These are among the most common targets. You can point your domain or subdomain directly to an ALB or NLB, and Route 53 automatically keeps the IP address in sync if the load balancer's IP changes.

**Amazon S3 static website hosting**: If you're hosting a static website directly from an S3 bucket, an Alias record lets you map your domain to that bucket without any workarounds.

**API Gateway endpoints**: When you deploy a REST API or HTTP API with API Gateway, you get an AWS-managed endpoint domain name. An Alias record can point your custom domain to that endpoint.

**Elastic Beanstalk environments**: Beanstalk creates load balancers automatically, and Alias records integrate seamlessly with them.

**Another Route 53 record in the same hosted zone**: You can even chain Alias records together for more complex routing scenarios.

The common thread is that these are all AWS-managed resources where Route 53 has direct integration and can query their current state.

### The Cost Advantage of Alias Records

Here's a financial incentive that often surprises developers: **queries to Alias records that point to AWS resources are free**. This is part of AWS's design philosophy—they want to encourage you to use their services and integrate them tightly.

If you have a very high-traffic website, this cost difference can be substantial. Consider a site receiving millions of DNS queries per day. With CNAME records, you'd be charged for every single query. With Alias records pointing to AWS resources, those queries cost nothing.

This isn't just a nice perk—it's a significant architectural consideration. For high-traffic applications, the cost savings alone can justify choosing Alias records when you have a choice.

### Comparing the Two in Practice

Let's look at a concrete scenario. Suppose you're running an e-commerce application with these components: a CloudFront distribution serving your storefront, an Application Load Balancer managing your backend API, and an S3 bucket for static assets. Your domain is `shop.example.com`.

Using CNAME records, you'd set up something like:

- `shop.example.com` → can't use CNAME here (zone apex restriction)
- `api.shop.example.com` → CNAME pointing to `my-alb-1234567890.us-east-1.elb.amazonaws.com`
- `cdn.shop.example.com` → CNAME pointing to `d123456.cloudfront.net`

This approach has problems: you've forced the root domain issue, you're incurring DNS query charges, and you need an extra DNS lookup for each resolution.

Using Alias records, you'd set up:

- `shop.example.com` → Alias to CloudFront distribution (zone apex solved, free queries, single DNS lookup)
- `api.shop.example.com` → Alias to Application Load Balancer (free queries, single DNS lookup)
- `static.shop.example.com` → Alias to S3 static website (free queries, single DNS lookup)

The Alias approach is cleaner, cheaper, and more performant.

### When to Still Use CNAME Records

Despite the advantages of Alias records, there are legitimate scenarios where CNAME records remain the right choice.

**External domains**: If you need to point to a domain outside AWS—say, a third-party service's API endpoint or a partner's infrastructure—CNAME is your only option. Alias records only work with AWS resources.

**Subdomains when you can't use Alias**: While Alias records work at the zone apex, they can also be used for subdomains. However, you might choose CNAME for a subdomain if you want to keep DNS configuration outside of Route 53, or if you're migrating gradually from another DNS provider.

**Legacy systems and compatibility**: Some older applications or edge cases might have compatibility requirements that make CNAME the safer choice, even if it's not optimal.

In most modern AWS architectures, though, Alias records should be your default for pointing to AWS resources. CNAME should be your fallback for external targets.

### Practical Example: Setting Up Both Record Types

Let's illustrate this with a concrete Route 53 example. Imagine your domain is `example.com` and you want to set up:

1. Root domain pointing to a CloudFront distribution (requires Alias)
2. API subdomain pointing to an Application Load Balancer (Alias preferred, but could use CNAME)
3. External monitoring service (must use CNAME)

For the root domain, you'd create an Alias record in Route 53:

```
Name: example.com
Type: A (Alias)
Target: my-distribution.cloudfront.net
Alias to CloudFront distribution: Yes
Evaluate Target Health: Yes
```

The key here is that Route 53 recognizes `my-distribution.cloudfront.net` as a CloudFront distribution and creates an Alias. When users query `example.com`, Route 53 returns the current IP addresses of the CloudFront distribution directly—no extra DNS lookup, no query charges.

For the API subdomain, you'd create another Alias record:

```
Name: api.example.com
Type: A (Alias)
Target: my-alb-123456.us-east-1.elb.amazonaws.com
Alias to load balancer: Yes
Evaluate Target Health: Yes
```

The "Evaluate Target Health" option is particularly useful here. If you enable it, Route 53 checks whether the load balancer is actually healthy before returning its IP. If the load balancer is down, Route 53 won't return it as a valid target—allowing you to failover to another record or handle it gracefully.

For an external service, you'd use a standard CNAME:

```
Name: monitoring.example.com
Type: CNAME
Value: api.external-monitoring.com
TTL: 300
```

Here, CNAME is the only option since the external service isn't an AWS resource.

### Health Checks and Alias Records

One more advantage of Alias records deserves mention: tight integration with Route 53 health checks. You can enable the "Evaluate Target Health" option on an Alias record, which makes Route 53 continuously monitor the health of the target resource. If the resource becomes unhealthy, Route 53 will automatically stop returning that Alias record in DNS responses, allowing traffic to failover to another record.

With CNAME records, you don't have this integration. You'd need to manage health checks separately or implement your own failover logic at the application level.

### Key Takeaways

The distinction between Alias and CNAME records in Route 53 comes down to a few core differences:

Alias records are AWS-specific and work at the zone apex, while CNAME records are standard DNS records that cannot be used at the root domain. Alias records provide faster resolution because Route 53 returns the final IP address directly, while CNAME records require an additional DNS lookup. Queries to Alias records pointing to AWS resources are free, whereas CNAME queries always incur charges. Alias records integrate tightly with Route 53 health checks for automatic failover, while CNAME records do not.

When you're architecting your AWS infrastructure, reach for Alias records first whenever you're pointing to an AWS resource. Use CNAME records for external targets or in situations where Alias records aren't supported. This approach will make your DNS configuration more efficient, cost-effective, and resilient.

Understanding this distinction is foundational for building reliable, scalable applications on AWS. It's one of those concepts that seems small at first but compounds into significant benefits as your infrastructure grows.
