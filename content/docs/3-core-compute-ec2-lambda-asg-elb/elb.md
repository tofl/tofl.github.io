---
title: "8. ELB"
type: docs
weight: 4
---

## Elastic Load Balancing (ELB)

When you run multiple EC2 instances (or Lambda functions, containers, or IP targets) to serve user traffic, you need something to sit in front of them and distribute incoming requests evenly, route them intelligently, and stop sending traffic to unhealthy targets. That is exactly what Elastic Load Balancing does. ELB is a managed service — AWS handles provisioning, scaling, and availability of the load balancer itself, so you only configure behavior. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/what-is-load-balancing.html)

### Load Balancer Types

AWS offers three types of load balancers under the ELB umbrella, each designed for a different layer of the network stack.

**Application Load Balancer (ALB)** operates at Layer 7 (HTTP/HTTPS). It understands the content of HTTP requests, which means it can route traffic based on URL path (`/api/*` goes to one target group, `/images/*` goes to another), hostname (`api.example.com` vs `www.example.com`), query string parameters, or HTTP headers. ALB is the right choice for web applications, REST APIs, and microservices architectures. It natively supports WebSockets and HTTP/2. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/introduction.html)

**Network Load Balancer (NLB)** operates at Layer 4 (TCP/UDP/TLS). It is designed for extreme performance — capable of handling millions of requests per second with ultra-low latency. A key characteristic of NLB is that it provides a **static IP address** (or lets you assign an Elastic IP) per Availability Zone. This is important when clients or firewall rules require a fixed IP to whitelist. NLB is the correct choice when your application is not HTTP-based (e.g., gaming, IoT, financial trading) or when you need static IPs in front of an HTTP service. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/network/introduction.html)

**Gateway Load Balancer (GWLB)** operates at Layer 3 and is purpose-built for deploying, scaling, and managing third-party network appliances such as firewalls, intrusion detection systems, and deep packet inspection tools. It is rarely tested directly on DVA-C02 but you should know it exists and what it solves. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/gateway/introduction.html)

### Target Groups and Health Checks

A **target group** is a logical grouping of the resources that will actually handle requests — EC2 instances, Lambda functions, ECS tasks, or IP addresses. The load balancer forwards traffic to a target group; the target group is responsible for routing to individual targets and monitoring their health.

**Health checks** are how the load balancer decides whether a target is fit to receive traffic. You configure a protocol, path (for HTTP/HTTPS), port, healthy threshold, unhealthy threshold, and interval. If a target fails the configured number of consecutive checks, the load balancer stops sending it traffic until it recovers. For ALB, a common pattern is exposing a dedicated `/health` endpoint that returns HTTP 200 only when the application is genuinely ready. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html)

### Listener Rules and Conditions

A **listener** is a process that checks for incoming connection requests on a specific protocol and port (e.g., HTTPS:443). Each listener has an ordered list of **rules**. Each rule contains one or more **conditions** and an **action**. When an incoming request matches a condition, the corresponding action is taken — most commonly forwarding to a target group, but also redirecting (e.g., HTTP → HTTPS), returning a fixed response, or authenticating with Cognito or an OIDC provider.

Rules are evaluated in priority order, and a default rule at the end catches anything that did not match a higher-priority rule. This is the mechanism that enables microservices routing on a single ALB: one load balancer, one DNS name, many services behind it. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/listener-update-rules.html)

### Sticky Sessions (Session Affinity)

By default, a load balancer routes each request independently, which means successive requests from the same client can land on different targets. **Sticky sessions** (also called session affinity) override this behavior by binding a client to a specific target for the duration of a session, using a cookie.

- **ALB-generated cookie** (`AWSALB`): The load balancer itself injects a cookie with a configurable duration.
- **Application-based cookie**: Your application sets its own cookie, and ALB uses it to maintain affinity.

Stickiness is useful when your application stores session state in memory on the instance rather than in an external store. However, it undermines even load distribution and can cause hotspots, so it is generally better to externalize session state (e.g., ElastiCache, DynamoDB) and avoid stickiness altogether. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html)

### Cross-Zone Load Balancing

When you have targets distributed across multiple Availability Zones, **cross-zone load balancing** controls whether each load balancer node distributes traffic only to targets in its own AZ, or evenly across all targets in all AZs.

- **ALB**: Cross-zone load balancing is enabled by default and cannot be disabled at the load balancer level (only at the target group level).
- **NLB and GWLB**: Disabled by default; enabling it may incur inter-AZ data transfer charges.

Without cross-zone load balancing, if AZ-A has two instances and AZ-B has eight, each AZ's load balancer node handles 50% of traffic — meaning the two instances in AZ-A each absorb 25% of total load while the eight instances in AZ-B each handle only 6.25%. Enabling cross-zone load balancing corrects this imbalance. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/userguide/how-elastic-load-balancing-works.html#cross-zone-load-balancing)

### SSL/TLS Termination

ELB can terminate HTTPS connections at the load balancer, decrypt the traffic, and forward plain HTTP to your targets. This offloads the CPU cost of TLS from your application servers. You attach an SSL/TLS certificate to the listener — certificates are managed via **AWS Certificate Manager (ACM)**, which handles renewal automatically. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html)

ALB supports **Server Name Indication (SNI)**, which allows a single listener on port 443 to serve multiple certificates for multiple domains. The load balancer selects the correct certificate based on the hostname in the TLS handshake. NLB also supports SNI. This is a common exam point: if a question asks how to host multiple HTTPS domains on one load balancer, the answer is SNI with multiple certificates.

### Connection Draining / Deregistration Delay

When a target is deregistered from a target group (for example, during a deployment or scale-in event), in-flight requests to that target should be allowed to complete rather than being abruptly cut off. **Connection draining** (called **deregistration delay** on ALB and NLB) gives existing connections time to finish before the load balancer stops sending traffic to the target.

The default is 300 seconds; you can set it anywhere from 0 (immediate) to 3600 seconds. Set it lower than the maximum duration of a request in your application. If your requests complete in under 5 seconds, a 30-second deregistration delay is more than sufficient and will make deployments faster. [🔗](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-target-groups.html#deregistration-delay)

### Integration with Auto Scaling Groups

ELB and ASG are designed to work together. When you attach an ALB target group to an ASG, newly launched instances are automatically registered with the target group, and terminated instances are automatically deregistered (with connection draining honored). The ASG can also use the load balancer's health checks — not just EC2 status checks — as the basis for deciding whether an instance is healthy. If an instance starts failing HTTP health checks, the ASG replaces it. This combination is the foundation of a self-healing, elastically scalable fleet and appears frequently in DVA-C02 scenario questions. [🔗](https://docs.aws.amazon.com/autoscaling/ec2/userguide/attach-load-balancer-asg.html)