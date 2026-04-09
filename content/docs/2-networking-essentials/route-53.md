---
title: "4. Route 53"
type: docs
weight: 2
---

## Route 53

Route 53 is AWS's managed DNS (Domain Name System) service. DNS is the internet's phone book — it translates human-readable domain names like `api.myapp.com` into IP addresses that computers use to route traffic. Route 53 goes beyond basic DNS by adding health checking, traffic routing logic, and deep integration with AWS services. For developers, understanding Route 53 at an awareness level is enough to wire up custom domains, configure failover, and reason about how traffic reaches your application.

The official Route 53 developer guide [🔗](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html) is the authoritative reference for everything covered here.

### DNS Record Types

When you register a domain or manage a hosted zone in Route 53, you create **records** that tell DNS resolvers where to send traffic. The ones you'll encounter most often:

- **A record** — Maps a domain name to an **IPv4 address** (e.g., `api.myapp.com` → `54.12.34.56`). This is the most common record type.
- **AAAA record** — Same as A, but for **IPv6 addresses**.
- **CNAME record** — Maps a domain name to **another domain name** (e.g., `www.myapp.com` → `myapp.com`). Important limitation: a CNAME cannot be used at the **zone apex** (the root domain itself, like `myapp.com`). This is where Alias records come in.
- **Alias record** — An AWS-specific extension that behaves like a CNAME but *can* be used at the zone apex, and it resolves directly to AWS resource endpoints (CloudFront distributions, ELBs, S3 static websites, API Gateway, etc.) without an extra DNS lookup. Alias records are free of charge for queries to AWS resources, unlike standard records. [🔗](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-choosing-alias-non-alias.html)

A practical rule of thumb: use an **Alias record** when pointing a domain at an AWS service endpoint, and a **CNAME** when pointing to any other external hostname.

### Routing Policies

Route 53 supports several routing policies that control *how* it responds to DNS queries. These aren't load balancers — they operate at the DNS layer — but they give you powerful traffic steering capabilities. [🔗](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy.html)

- **Simple** — Returns a single resource. No logic, no health checks. Use this for straightforward setups where only one endpoint exists.
- **Weighted** — Splits traffic across multiple resources by assigning relative weights. Useful for **canary deployments**: send 10% of traffic to a new version, 90% to the old one, and gradually shift the balance.
- **Latency** — Routes users to the AWS Region that provides the **lowest network latency** for them. Ideal for globally deployed applications where you want users in Europe hitting your `eu-west-1` stack rather than `us-east-1`.
- **Failover** — Designates one record as **primary** and another as **secondary**. Route 53 serves the primary as long as its health check passes; if it fails, traffic automatically shifts to the secondary. This is the foundation of active-passive DNS failover.
- **Geolocation** — Routes traffic based on the **geographic location of the requester** (country or continent). Different from latency routing — this is about compliance and content localization, not speed (e.g., serving EU users from an EU endpoint to satisfy data residency requirements).

### Health Checks and DNS Failover

Health checks are Route 53's mechanism for monitoring the availability of your endpoints. Route 53 sends periodic requests to your resource (an HTTP/HTTPS endpoint, a TCP port, or even a CloudWatch alarm) and marks it healthy or unhealthy based on the response. [🔗](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/dns-failover.html)

Health checks become meaningful when combined with routing policies. With **Failover routing**, Route 53 will stop returning the primary record's IP the moment its health check fails and will start returning the secondary record instead — all automatically, within the TTL window. This gives you DNS-level resilience without any manual intervention.

Health checks can also monitor **other health checks** (calculated health checks), allowing you to build composite readiness signals from multiple components before declaring a resource healthy.

### TTL and Caching Behavior

Every DNS record has a **TTL (Time To Live)**, expressed in seconds, that tells resolvers how long to cache the answer before asking Route 53 again. This has direct operational consequences:

- A **high TTL** (e.g., 86400 = 24 hours) reduces DNS query costs and speeds up resolution for end users, but means changes propagate slowly. Don't use a high TTL on records you may need to change quickly.
- A **low TTL** (e.g., 60 seconds) makes record changes take effect quickly — important during failover scenarios or blue/green deployments — but increases the number of DNS queries (and therefore cost).

A common operational pattern is to **lower the TTL well before a planned change** (e.g., a few days before a migration), perform the change, then raise it again afterward. Alias records that point to AWS services have their TTL managed by Route 53 and cannot be configured manually.

### Private Hosted Zones

By default, hosted zones in Route 53 are **public** — they answer DNS queries from anywhere on the internet. A **private hosted zone** answers queries only from within one or more associated VPCs. [🔗](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/hosted-zones-private.html)

This is how you give internal services friendly DNS names without exposing them publicly. For example, your application tier might resolve `payments-service.internal` to a private IP inside your VPC, while that name is completely invisible from the internet. Private hosted zones are essential when building microservice architectures or multi-tier applications entirely within a VPC.

To use private hosted zones, **DNS resolution and DNS hostnames must be enabled** on the associated VPC — these are VPC settings, not Route 53 settings, and they're enabled by default on VPCs created via the console.