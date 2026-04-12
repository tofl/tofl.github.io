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

{{< qcm >}}
[
{
"question": "A company is building a microservices platform where different services handle different URL paths: `/api/*` routes to a backend API service and `/static/*` routes to a static content service. Which AWS load balancer type should they use?",
"answers": [
{
"answer": "Application Load Balancer (ALB)",
"isCorrect": true,
"explanation": "ALB operates at Layer 7 and can route traffic based on URL path, hostname, query string parameters, and HTTP headers — making it the right choice for content-based routing between microservices."
},
{
"answer": "Network Load Balancer (NLB)",
"isCorrect": false,
"explanation": "NLB operates at Layer 4 (TCP/UDP) and has no awareness of HTTP content such as URL paths. It cannot perform path-based routing."
},
{
"answer": "Gateway Load Balancer (GWLB)",
"isCorrect": false,
"explanation": "GWLB operates at Layer 3 and is purpose-built for deploying third-party network appliances like firewalls and intrusion detection systems, not for HTTP routing."
}
]
},
{
"question": "A financial trading application requires a load balancer that can handle millions of requests per second with ultra-low latency, and the client firewalls need to whitelist a fixed IP address. Which load balancer type best meets these requirements?",
"answers": [
{
"answer": "Application Load Balancer (ALB)",
"isCorrect": false,
"explanation": "ALB does not provide a static IP address per Availability Zone and is optimized for HTTP/HTTPS workloads rather than the ultra-low latency required by financial trading systems."
},
{
"answer": "Network Load Balancer (NLB)",
"isCorrect": true,
"explanation": "NLB operates at Layer 4, handles millions of requests per second with ultra-low latency, and provides a static IP address (or allows Elastic IP assignment) per Availability Zone — ideal for firewall whitelisting and non-HTTP protocols."
},
{
"answer": "Gateway Load Balancer (GWLB)",
"isCorrect": false,
"explanation": "GWLB is designed for deploying and scaling third-party network appliances such as firewalls and intrusion detection systems, not for serving application traffic directly."
}
]
},
{
"question": "A developer configures an ALB listener rule with the following actions: forward to target group A for requests matching `/api/*`, redirect HTTP to HTTPS for all other requests. How does ALB evaluate these rules?",
"answers": [
{
"answer": "Rules are evaluated in priority order; the first matching rule's action is executed.",
"isCorrect": true,
"explanation": "ALB evaluates listener rules in priority order and executes the action of the first rule whose conditions match the incoming request. A default rule at the end catches any unmatched requests."
},
{
"answer": "All matching rules are executed sequentially.",
"isCorrect": false,
"explanation": "ALB does not execute multiple rules for a single request. Only the first matching rule (by priority) is acted upon."
},
{
"answer": "Rules are evaluated randomly to distribute load evenly.",
"isCorrect": false,
"explanation": "Rule evaluation is deterministic and priority-based, not random. Random selection applies to target selection within a target group, not to rule matching."
},
{
"answer": "The default rule is always evaluated first.",
"isCorrect": false,
"explanation": "The default rule is always last — it acts as a catch-all for requests that did not match any higher-priority rule."
}
]
},
{
"question": "An application currently stores user session state in memory on each EC2 instance. Users are reporting that they are occasionally logged out mid-session. The application sits behind an ALB. What is the most likely cause, and what is the recommended long-term solution?",
"answers": [
{
"answer": "The ALB is routing successive requests to different instances; enable sticky sessions using the AWSALB cookie.",
"isCorrect": false,
"explanation": "Enabling sticky sessions would address the symptom, but it undermines even load distribution and can cause hotspots. It is not the recommended long-term solution."
},
{
"answer": "The ALB is routing successive requests to different instances; externalize session state to a store like ElastiCache or DynamoDB.",
"isCorrect": true,
"explanation": "By default, ALB routes each request independently, so successive requests can land on different instances, causing in-memory session state to be lost. The recommended solution is to externalize session state so any instance can serve any request."
},
{
"answer": "The ALB health checks are incorrectly configured and marking healthy instances as unhealthy.",
"isCorrect": false,
"explanation": "Misconfigured health checks would cause instances to be removed from rotation, but would not directly cause users to lose session state across requests."
},
{
"answer": "Cross-zone load balancing must be disabled to keep users on the same instance.",
"isCorrect": false,
"explanation": "Cross-zone load balancing controls traffic distribution across AZs, not session affinity. Disabling it would not reliably bind a user to a specific instance."
}
]
},
{
"question": "A company has two Availability Zones behind an ALB. AZ-A contains 2 EC2 instances and AZ-B contains 8 EC2 instances. Cross-zone load balancing is disabled at the target group level. How is traffic distributed across the instances?",
"answers": [
{
"answer": "Each instance receives an equal share of 10% of total traffic.",
"isCorrect": false,
"explanation": "This would be the result with cross-zone load balancing enabled. Without it, each AZ's load balancer node handles 50% of traffic independently."
},
{
"answer": "Each AZ receives 50% of total traffic; the 2 instances in AZ-A each handle 25%, while the 8 instances in AZ-B each handle 6.25%.",
"isCorrect": true,
"explanation": "Without cross-zone load balancing, each load balancer node distributes traffic only within its own AZ. With 50% of traffic going to each AZ, the 2 instances in AZ-A each absorb 25% of total load while the 8 instances in AZ-B each handle only 6.25%."
},
{
"answer": "Traffic is routed exclusively to AZ-B because it has more instances.",
"isCorrect": false,
"explanation": "ELB does not route traffic based on the number of instances in an AZ. Without cross-zone load balancing, each AZ receives an equal share of traffic from its load balancer node."
},
{
"answer": "AZ-A receives 80% of traffic because it has fewer instances and they need more load.",
"isCorrect": false,
"explanation": "ELB does not adjust AZ-level traffic shares based on instance count. Each AZ's node receives an equal portion of traffic, regardless of how many targets are registered in that AZ."
}
]
},
{
"question": "Which of the following statements about cross-zone load balancing on AWS load balancers are correct? (Select TWO)",
"answers": [
{
"answer": "For ALB, cross-zone load balancing is enabled by default and can only be disabled at the target group level.",
"isCorrect": true,
"explanation": "ALB enables cross-zone load balancing by default at the load balancer level; it can be toggled off at the target group level, but not at the load balancer level."
},
{
"answer": "For NLB, cross-zone load balancing is enabled by default.",
"isCorrect": false,
"explanation": "For NLB (and GWLB), cross-zone load balancing is disabled by default. Enabling it may incur inter-AZ data transfer charges."
},
{
"answer": "Enabling cross-zone load balancing on NLB may incur inter-AZ data transfer charges.",
"isCorrect": true,
"explanation": "When cross-zone load balancing is enabled on NLB, traffic can cross AZ boundaries, which may result in inter-AZ data transfer charges — unlike ALB where it is included by default."
},
{
"answer": "Cross-zone load balancing guarantees sticky sessions across Availability Zones.",
"isCorrect": false,
"explanation": "Cross-zone load balancing controls even distribution of traffic across all registered targets in all AZs. It has nothing to do with session affinity, which is managed via sticky sessions."
}
]
},
{
"question": "A company wants to serve multiple HTTPS domains (e.g., api.example.com and www.example.com) using a single ALB listener on port 443. What feature enables this?",
"answers": [
{
"answer": "Host-based routing with separate listeners for each domain",
"isCorrect": false,
"explanation": "You can only have one listener per port. Host-based routing is a listener rule condition, not a separate listener — and it does not by itself allow multiple SSL certificates."
},
{
"answer": "Server Name Indication (SNI) with multiple certificates on the listener",
"isCorrect": true,
"explanation": "ALB supports SNI, which allows a single listener on port 443 to serve multiple SSL/TLS certificates for different domains. The load balancer selects the correct certificate based on the hostname in the TLS handshake."
},
{
"answer": "A wildcard certificate covering all subdomains",
"isCorrect": false,
"explanation": "A wildcard certificate can cover multiple subdomains under one domain (e.g., *.example.com), but it cannot cover multiple distinct domains. SNI is the mechanism that allows serving different certificates per domain."
},
{
"answer": "Cross-zone load balancing with per-AZ certificates",
"isCorrect": false,
"explanation": "Cross-zone load balancing is about traffic distribution across Availability Zones and has no relationship to SSL certificate management or multi-domain HTTPS."
}
]
},
{
"question": "An application's EC2 instances are being deregistered from an ALB target group during a rolling deployment. Some users are experiencing abrupt connection resets mid-request. What configuration change would most likely resolve this?",
"answers": [
{
"answer": "Increase the deregistration delay (connection draining) to allow in-flight requests to complete before traffic stops.",
"isCorrect": true,
"explanation": "Deregistration delay (connection draining) gives existing in-flight requests time to complete before the load balancer stops sending traffic to a deregistering target. Increasing this value prevents abrupt connection resets during deployments."
},
{
"answer": "Enable sticky sessions so users stay connected to the same instance.",
"isCorrect": false,
"explanation": "Sticky sessions bind users to a specific instance for session affinity. They do not prevent connection resets when an instance is deregistered — in fact, sticky sessions could make things worse if the bound instance is removed."
},
{
"answer": "Enable cross-zone load balancing to spread connections across AZs.",
"isCorrect": false,
"explanation": "Cross-zone load balancing improves traffic distribution across Availability Zones but has no effect on in-flight connections to a deregistering instance."
},
{
"answer": "Attach an SSL certificate via ACM to encrypt traffic between the ALB and targets.",
"isCorrect": false,
"explanation": "SSL/TLS termination is about encrypting traffic, not about gracefully completing in-flight requests during deregistration."
}
]
},
{
"question": "A developer sets the deregistration delay on an ALB target group to 0 seconds. What is the effect of this configuration?",
"answers": [
{
"answer": "The load balancer immediately stops sending traffic to deregistering targets, terminating any in-flight requests.",
"isCorrect": true,
"explanation": "Setting deregistration delay to 0 disables the waiting period entirely. The load balancer immediately stops routing traffic to a target being deregistered, which will abruptly cut off any in-flight requests."
},
{
"answer": "The load balancer uses the default delay of 300 seconds as a fallback.",
"isCorrect": false,
"explanation": "Setting the delay to 0 is a valid configuration that disables draining entirely. There is no automatic fallback to the default value."
},
{
"answer": "In-flight requests are held in a queue until the instance is available again.",
"isCorrect": false,
"explanation": "ELB does not queue requests to deregistering targets. With a 0-second delay, in-flight requests are immediately dropped, not queued."
},
{
"answer": "Deployments are slowed down because the load balancer waits for all existing connections to close naturally.",
"isCorrect": false,
"explanation": "A 0-second delay does the opposite — it makes deployments faster by not waiting at all, at the cost of dropping in-flight requests."
}
]
},
{
"question": "An Auto Scaling Group is attached to an ALB target group. An instance passes EC2 status checks but begins failing the ALB HTTP health checks on the `/health` endpoint. What happens?",
"answers": [
{
"answer": "The ALB stops routing traffic to the instance, but the ASG takes no action because the EC2 status check still passes.",
"isCorrect": false,
"explanation": "If the ASG is configured to use ELB health checks (not just EC2 status checks), it will act on ALB health check failures and terminate and replace the unhealthy instance."
},
{
"answer": "The ALB stops routing traffic to the instance, and if the ASG uses ELB health checks, it will terminate and replace the instance.",
"isCorrect": true,
"explanation": "When an ASG is configured to use ELB health checks, failing ALB health checks cause the ASG to mark the instance as unhealthy and replace it — even if EC2 status checks pass. This creates a self-healing fleet."
},
{
"answer": "The instance is immediately terminated by the ALB.",
"isCorrect": false,
"explanation": "The ALB does not terminate EC2 instances. It only stops routing traffic to targets that fail health checks. Instance lifecycle management is handled by the ASG."
},
{
"answer": "Nothing happens; the ASG only responds to CloudWatch alarms, not health check failures.",
"isCorrect": false,
"explanation": "ASGs can be configured to use ELB health checks in addition to (or instead of) EC2 status checks. When configured this way, failing ELB health checks trigger instance replacement."
}
]
},
{
"question": "Which of the following are valid target types for an ALB target group? (Select THREE)",
"answers": [
{
"answer": "EC2 instances",
"isCorrect": true,
"explanation": "EC2 instances are a standard target type for ALB target groups and are registered by instance ID."
},
{
"answer": "Lambda functions",
"isCorrect": true,
"explanation": "ALB supports Lambda functions as targets, allowing serverless backends to serve HTTP traffic behind a load balancer."
},
{
"answer": "IP addresses",
"isCorrect": true,
"explanation": "ALB target groups can route to specific IP addresses, which is useful for on-premises targets or containers with their own IP."
},
{
"answer": "S3 buckets",
"isCorrect": false,
"explanation": "S3 buckets are not a supported target type for ELB target groups. To serve static content from S3 via a load balancer, you would use CloudFront or an alternative architecture."
},
{
"answer": "RDS database instances",
"isCorrect": false,
"explanation": "RDS instances are not a valid ALB target type. ELB targets application-layer servers, not managed database services."
}
]
},
{
"question": "A company wants to offload SSL/TLS decryption from their EC2 instances to reduce CPU usage. They also need automatic certificate renewal. Which combination of AWS services should they use?",
"answers": [
{
"answer": "Application Load Balancer with certificates managed by AWS Certificate Manager (ACM)",
"isCorrect": true,
"explanation": "ALB can terminate HTTPS at the load balancer, offloading TLS decryption from EC2 instances. ACM manages certificate provisioning and automatic renewal, removing operational overhead."
},
{
"answer": "Network Load Balancer with self-managed certificates stored in S3",
"isCorrect": false,
"explanation": "Storing certificates in S3 is not a supported pattern for ELB. Certificates should be managed via ACM or IAM. Additionally, self-managed certificates require manual renewal."
},
{
"answer": "Application Load Balancer with certificates stored and rotated manually in EC2 instance storage",
"isCorrect": false,
"explanation": "Storing certificates on EC2 instances means the instances still handle TLS, negating the offloading benefit. Manual rotation also introduces operational risk and does not meet the automatic renewal requirement."
},
{
"answer": "Gateway Load Balancer with certificates managed by AWS Secrets Manager",
"isCorrect": false,
"explanation": "GWLB is designed for third-party network appliances, not for terminating HTTPS for application traffic. Secrets Manager is for application secrets, not certificate lifecycle management for load balancers."
}
]
},
{
"question": "A development team wants a single ALB to front multiple microservices, each reachable via a different hostname (e.g., orders.internal.com, inventory.internal.com). Which ALB feature makes this possible without deploying additional load balancers?",
"answers": [
{
"answer": "Listener rules with host-header conditions forwarding to separate target groups",
"isCorrect": true,
"explanation": "ALB listener rules support host-header as a routing condition. Requests for orders.internal.com can be forwarded to the orders target group, and requests for inventory.internal.com to the inventory target group — all on the same ALB."
},
{
"answer": "Cross-zone load balancing routing based on hostname",
"isCorrect": false,
"explanation": "Cross-zone load balancing distributes traffic across Availability Zones evenly. It does not perform hostname-based routing."
},
{
"answer": "Sticky sessions binding each hostname to a fixed target",
"isCorrect": false,
"explanation": "Sticky sessions bind a client (not a hostname) to a specific target using a cookie. They are unrelated to hostname-based routing."
},
{
"answer": "Deploying one NLB per microservice with a static IP per service",
"isCorrect": false,
"explanation": "This would require multiple load balancers and adds unnecessary cost and complexity. ALB's host-header routing achieves hostname-based microservice routing on a single load balancer."
}
]
},
{
"question": "An ALB is configured with an HTTPS listener on port 443. The security team asks that the load balancer forward only plain HTTP to backend instances to simplify instance-level configuration. What does this describe?",
"answers": [
{
"answer": "SSL/TLS termination at the load balancer",
"isCorrect": true,
"explanation": "SSL/TLS termination means the ALB decrypts HTTPS traffic from clients and forwards unencrypted HTTP to backend targets. This offloads TLS processing from instances and simplifies their configuration."
},
{
"answer": "SSL/TLS passthrough",
"isCorrect": false,
"explanation": "SSL passthrough means the load balancer forwards encrypted traffic without decrypting it, leaving TLS termination to the backend instances. This is the opposite of what is described."
},
{
"answer": "End-to-end encryption between client and instance",
"isCorrect": false,
"explanation": "End-to-end encryption means both the client-to-LB and LB-to-instance connections are encrypted. The scenario describes the LB forwarding plain HTTP to instances, so there is no encryption on the backend leg."
},
{
"answer": "Server Name Indication (SNI)",
"isCorrect": false,
"explanation": "SNI is a TLS extension that allows a single listener to serve multiple certificates for multiple domains. It does not describe the act of terminating TLS and forwarding plain HTTP to backends."
}
]
},
{
"question": "When a new EC2 instance is launched by an Auto Scaling Group that is attached to an ALB target group, what happens automatically?",
"answers": [
{
"answer": "The new instance is automatically registered with the target group and begins receiving traffic once health checks pass.",
"isCorrect": true,
"explanation": "When an ASG is attached to an ALB target group, new instances are automatically registered upon launch and removed upon termination. The ALB will only route traffic to them after they pass the configured health checks."
},
{
"answer": "The instance must be manually registered with the target group via the AWS Console or CLI.",
"isCorrect": false,
"explanation": "Manual registration is not required when an ASG is attached to a target group. Registration and deregistration are handled automatically by the ASG-ELB integration."
},
{
"answer": "The instance is registered immediately and begins receiving traffic before health checks run.",
"isCorrect": false,
"explanation": "The ALB will not route traffic to a newly registered target until it passes the configured health checks (reaches the healthy threshold)."
},
{
"answer": "A new listener rule is created automatically for each new instance.",
"isCorrect": false,
"explanation": "Listener rules route to target groups, not to individual instances. No new rules are created when instances are added to a target group."
}
]
}
]
{{< /qcm >}}