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

{{< qcm >}}
[
{
"question": "A developer wants to point the root domain `myapp.com` to an Application Load Balancer. Which DNS record type should they use in Route 53?",
"answers": [
{
"answer": "A record",
"isCorrect": false,
"explanation": "An A record maps a domain to a static IPv4 address. Load Balancers don't have static IPs, so this is not appropriate."
},
{
"answer": "CNAME record",
"isCorrect": false,
"explanation": "A CNAME cannot be used at the zone apex (root domain). Using a CNAME for `myapp.com` directly is not allowed by DNS standards."
},
{
"answer": "Alias record",
"isCorrect": true,
"explanation": "Alias records are AWS-specific and can be used at the zone apex. They resolve directly to AWS resource endpoints like ALBs without an extra DNS lookup, and queries to AWS resources are free."
},
{
"answer": "AAAA record",
"isCorrect": false,
"explanation": "An AAAA record maps a domain to a static IPv6 address. Like A records, it requires a static IP and cannot point to an ALB hostname."
}
]
},
{
"question": "A company wants to route 5% of traffic to a new version of their application while keeping 95% on the current version. Which Route 53 routing policy should they use?",
"answers": [
{
"answer": "Failover",
"isCorrect": false,
"explanation": "Failover routing is for active-passive setups based on health check results. It does not support percentage-based traffic splitting."
},
{
"answer": "Weighted",
"isCorrect": true,
"explanation": "Weighted routing allows you to assign relative weights to multiple records, making it ideal for canary deployments where you gradually shift traffic between versions."
},
{
"answer": "Latency",
"isCorrect": false,
"explanation": "Latency routing directs users to the AWS Region with the lowest latency. It does not support percentage-based traffic distribution."
},
{
"answer": "Simple",
"isCorrect": false,
"explanation": "Simple routing returns a single resource with no logic. It cannot split traffic between multiple endpoints."
}
]
},
{
"question": "A globally deployed application runs in `us-east-1` and `eu-west-1`. The team wants users to be served from the region that gives them the best network performance. Which routing policy should they configure?",
"answers": [
{
"answer": "Geolocation",
"isCorrect": false,
"explanation": "Geolocation routing directs traffic based on the requester's geographic location (country/continent), not on actual network performance. It is designed for compliance and content localization, not speed optimization."
},
{
"answer": "Latency",
"isCorrect": true,
"explanation": "Latency routing directs each user to the AWS Region that provides the lowest network latency for them, which is exactly what is needed for optimizing performance in a multi-region application."
},
{
"answer": "Weighted",
"isCorrect": false,
"explanation": "Weighted routing distributes traffic by percentage. It does not consider network latency or the user's geographic proximity to a region."
},
{
"answer": "Failover",
"isCorrect": false,
"explanation": "Failover routing switches from a primary to a secondary endpoint when a health check fails. It is not designed for performance-based traffic steering."
}
]
},
{
"question": "An EU regulation requires that European users' requests must be served exclusively from an EU-based endpoint. Which Route 53 routing policy satisfies this requirement?",
"answers": [
{
"answer": "Latency",
"isCorrect": false,
"explanation": "Latency routing optimizes for speed, not geographic compliance. A European user could theoretically be routed to a non-EU region if latency happens to be lower there."
},
{
"answer": "Geolocation",
"isCorrect": true,
"explanation": "Geolocation routing directs traffic based on the requester's country or continent, ensuring EU users are always served from an EU endpoint regardless of latency — meeting data residency requirements."
},
{
"answer": "Weighted",
"isCorrect": false,
"explanation": "Weighted routing splits traffic by percentage and has no awareness of where the requesting user is located."
},
{
"answer": "Simple",
"isCorrect": false,
"explanation": "Simple routing returns a single resource with no location awareness or conditional logic."
}
]
},
{
"question": "A developer configures a Route 53 Failover routing policy with a primary and secondary record. What must also be configured for automatic DNS failover to work?",
"answers": [
{
"answer": "A CloudFront distribution in front of the primary endpoint",
"isCorrect": false,
"explanation": "CloudFront is a CDN and is not required for Route 53 DNS failover to function."
},
{
"answer": "A health check associated with the primary record",
"isCorrect": true,
"explanation": "Route 53 uses health checks to monitor the availability of the primary endpoint. Without a health check, Route 53 cannot detect a failure and will not switch to the secondary record."
},
{
"answer": "An Alias record pointing to the secondary endpoint",
"isCorrect": false,
"explanation": "While Alias records are useful for pointing to AWS resources, they are not a prerequisite for DNS failover. The key requirement is a health check on the primary record."
},
{
"answer": "Setting TTL to 0 on both records",
"isCorrect": false,
"explanation": "TTL cannot be set to 0 in Route 53. While a low TTL helps failover propagate quickly, it is not the mechanism that triggers the failover — the health check is."
}
]
},
{
"question": "Which of the following can Route 53 health checks monitor? (Select all that apply)",
"answers": [
{
"answer": "An HTTP/HTTPS endpoint",
"isCorrect": true,
"explanation": "Route 53 health checks can send periodic HTTP or HTTPS requests to an endpoint and mark it healthy or unhealthy based on the response."
},
{
"answer": "A TCP port",
"isCorrect": true,
"explanation": "Route 53 supports TCP-based health checks in addition to HTTP/HTTPS, allowing monitoring of non-web services."
},
{
"answer": "A CloudWatch alarm",
"isCorrect": true,
"explanation": "Route 53 health checks can be tied to CloudWatch alarms, enabling composite health signals based on custom metrics."
},
{
"answer": "An S3 bucket's storage usage",
"isCorrect": false,
"explanation": "Route 53 does not directly monitor S3 storage metrics. You could indirectly use a CloudWatch alarm for this, but S3 storage usage is not a native health check target."
}
]
},
{
"question": "A team is planning to migrate their application to a new server next week. They want DNS changes to propagate within 1 minute of the cutover. What should they do several days before the migration?",
"answers": [
{
"answer": "Delete the existing DNS record and recreate it on migration day",
"isCorrect": false,
"explanation": "Deleting the record would cause downtime. The correct approach is to lower the TTL in advance so cached records expire quickly when the change is made."
},
{
"answer": "Lower the TTL of the DNS record to 60 seconds",
"isCorrect": true,
"explanation": "Reducing the TTL ahead of a planned change ensures resolvers cache the record for only 60 seconds. When the record is updated on migration day, the change propagates quickly within that TTL window."
},
{
"answer": "Switch to an Alias record pointing to an AWS resource",
"isCorrect": false,
"explanation": "Alias records have their TTL managed by Route 53 and cannot be set manually. This does not directly solve the propagation speed concern for a migration."
},
{
"answer": "Enable DNS failover on the record",
"isCorrect": false,
"explanation": "Failover routing is for automatic high-availability switching based on health checks, not for controlling how quickly planned changes propagate."
}
]
},
{
"question": "What is a key difference between Alias records and CNAME records in Route 53?",
"answers": [
{
"answer": "Alias records support IPv6, while CNAME records do not",
"isCorrect": false,
"explanation": "IPv6 support is handled by AAAA records, not by Alias vs. CNAME distinction. This is not a differentiating characteristic."
},
{
"answer": "Alias records can be used at the zone apex; CNAME records cannot",
"isCorrect": true,
"explanation": "DNS standards prohibit CNAME records at the zone apex (root domain). Alias records are an AWS extension that lifts this restriction, allowing root domains to point to AWS service endpoints."
},
{
"answer": "CNAME records are free; Alias records incur charges per query",
"isCorrect": false,
"explanation": "It is the opposite: Alias record queries to AWS resources are free, while standard DNS queries (including CNAMEs) may incur charges."
},
{
"answer": "CNAME records can point to AWS resources; Alias records cannot",
"isCorrect": false,
"explanation": "Alias records are specifically designed to point to AWS resource endpoints such as CloudFront, ELBs, and API Gateway. CNAME records can point to any external hostname."
}
]
},
{
"question": "A developer configures a private hosted zone in Route 53 for internal service discovery. After associating it with a VPC, EC2 instances in the VPC still cannot resolve the internal DNS names. What is the most likely cause?",
"answers": [
{
"answer": "The private hosted zone was created in the wrong AWS Region",
"isCorrect": false,
"explanation": "Route 53 is a global service. Private hosted zones are not region-specific, so this would not cause resolution failure."
},
{
"answer": "DNS resolution and/or DNS hostnames are not enabled on the VPC",
"isCorrect": true,
"explanation": "Private hosted zones require both DNS resolution and DNS hostnames to be enabled on the associated VPC. These are VPC-level settings (enabled by default on console-created VPCs) and must be active for internal DNS resolution to work."
},
{
"answer": "The EC2 instances need Elastic IPs to use private DNS",
"isCorrect": false,
"explanation": "Private DNS resolution within a VPC does not require Elastic IPs. It works with private IP addresses."
},
{
"answer": "A health check must be configured for the private hosted zone records",
"isCorrect": false,
"explanation": "Health checks are not required for basic DNS resolution in private hosted zones. The issue lies in the VPC network configuration."
}
]
},
{
"question": "Which statement best describes the difference between Geolocation and Latency routing policies in Route 53?",
"answers": [
{
"answer": "Geolocation routing optimizes for speed; Latency routing enforces geographic boundaries",
"isCorrect": false,
"explanation": "This is reversed. Latency routing optimizes for speed (lowest network latency), while Geolocation routing enforces geographic rules regardless of speed."
},
{
"answer": "Latency routing directs users to the region with the lowest network latency; Geolocation routing directs users based on their physical location",
"isCorrect": true,
"explanation": "Latency routing is about network performance — users go to the fastest region. Geolocation routing is about the requester's country or continent, used for compliance, content localization, or data residency requirements."
},
{
"answer": "They are functionally equivalent; the only difference is the configuration interface",
"isCorrect": false,
"explanation": "They serve fundamentally different purposes. Latency routing uses network performance data, while Geolocation routing uses the IP-based geographic location of the requester."
},
{
"answer": "Geolocation routing requires health checks; Latency routing does not",
"isCorrect": false,
"explanation": "Neither routing policy inherently requires health checks. Health checks are optional for both and are independent of the routing policy type."
}
]
},
{
"question": "A Route 53 DNS record has a TTL of 86400 seconds. A developer updates the record to point to a new IP address. How long might it take before all users see the updated record?",
"answers": [
{
"answer": "Immediately after saving the change in the Route 53 console",
"isCorrect": false,
"explanation": "Route 53 propagates changes quickly on its side, but DNS resolvers across the internet cache the old record for the duration of the TTL — up to 24 hours in this case."
},
{
"answer": "Up to 86400 seconds (24 hours)",
"isCorrect": true,
"explanation": "The TTL of 86400 seconds (24 hours) tells resolvers to cache the answer for a full day. Users whose resolvers cached the old record before the change may not see the update until their cache expires."
},
{
"answer": "Up to 60 seconds",
"isCorrect": false,
"explanation": "A 60-second propagation window would correspond to a TTL of 60. With a TTL of 86400, cached records can persist for up to 24 hours."
},
{
"answer": "The TTL has no impact on how quickly changes propagate",
"isCorrect": false,
"explanation": "TTL directly controls caching behavior. A high TTL means slow propagation of changes because resolvers hold cached answers longer."
}
]
},
{
"question": "A developer wants to use Route 53 health checks to build a composite readiness signal from multiple application components before marking a resource as healthy. Which Route 53 feature supports this?",
"answers": [
{
"answer": "Weighted routing with multiple health checks",
"isCorrect": false,
"explanation": "Weighted routing distributes traffic by percentage. It does not natively combine multiple health checks into a single composite signal."
},
{
"answer": "Calculated health checks",
"isCorrect": true,
"explanation": "Calculated health checks allow a Route 53 health check to monitor other health checks, creating a composite readiness signal. A resource can be declared healthy only when all child health checks pass."
},
{
"answer": "Private hosted zone health monitoring",
"isCorrect": false,
"explanation": "Private hosted zones are for internal DNS resolution within a VPC. They do not provide a mechanism for combining multiple health signals."
},
{
"answer": "TTL-based health aggregation",
"isCorrect": false,
"explanation": "TTL controls DNS caching duration. It has no relationship to health check aggregation."
}
]
},
{
"question": "Which of the following are valid use cases for a private hosted zone in Route 53? (Select all that apply)",
"answers": [
{
"answer": "Resolving `payments-service.internal` to a private IP address within a VPC",
"isCorrect": true,
"explanation": "Private hosted zones are designed exactly for this: giving internal services friendly DNS names that resolve to private IPs and are invisible from the public internet."
},
{
"answer": "Enabling service discovery for a microservices architecture within a VPC",
"isCorrect": true,
"explanation": "Private hosted zones allow microservices to discover each other by DNS name rather than hardcoded IPs, which is a common pattern in VPC-based architectures."
},
{
"answer": "Serving DNS responses to users on the public internet for a SaaS product",
"isCorrect": false,
"explanation": "Private hosted zones only respond to DNS queries from within associated VPCs. Public-facing DNS requires a public hosted zone."
},
{
"answer": "Preventing internal service names from being visible on the public internet",
"isCorrect": true,
"explanation": "Because private hosted zones only respond to queries from associated VPCs, internal DNS names are completely invisible to the public internet — a key security benefit."
}
]
}
]
{{< /qcm >}}