---
title: "Network Load Balancer Static IPs and Elastic IPs: When to Use Them"
---

## Network Load Balancer Static IPs and Elastic IPs: When to Use Them

When you're designing infrastructure on AWS, load balancers are fundamental to distributing traffic. But there's a subtle feature of the Network Load Balancer that often catches developers off guard: the ability to assign a static IP address to each Availability Zone. This isn't a luxury—it's a lifeline in certain architectural scenarios. Understanding when and why to leverage this capability will help you make smarter decisions about your application's networking layer.

### Why Static IPs Matter in the Cloud

At first glance, it seems odd that static IPs would be a concern in AWS. The cloud is designed for elasticity and dynamic resource allocation. Instances come and go, load balancers scale, and the whole point is to abstract away the physical infrastructure.

But the real world isn't always so tidy. Consider a legacy financial services client that maintains an on-premises core banking system. That system connects to AWS for certain workloads, but the connection logic is hardcoded with IP addresses—changing it requires weeks of change management and testing. Or think about a government agency with compliance requirements that mandate all outbound traffic originate from a pre-approved list of IP addresses for audit purposes. In scenarios like these, you can't simply rely on the dynamic nature of AWS. You need predictable, static IP addresses that your firewall rules, access control lists, and contractual agreements can reference.

This is where the Network Load Balancer's static IP feature becomes indispensable. Unlike the Application Load Balancer, which operates at Layer 7 (the application layer) and doesn't have a concept of persistent IPs, the NLB operates at Layer 4 (the transport layer) and can expose a single, stable IP address per Availability Zone.

### The Network Load Balancer and Availability Zone IPs

To understand how NLB static IPs work, you first need to grasp how the Network Load Balancer itself is architected. An NLB is distributed across the Availability Zones you specify when you create it. Each AZ gets its own network interface and, crucially, its own IP address.

When you create an NLB and enable it in multiple Availability Zones, AWS automatically allocates an elastic network interface (ENI) in each AZ. Each ENI gets a primary private IP address from your VPC's subnet. If you've enabled public subnets and the "assign public IP" setting, each ENI also gets an associated public IP address (which is, in fact, an Elastic IP under the hood).

This architecture has a profound implication: if you route traffic to the NLB's DNS name, AWS's DNS service will resolve that name to all the public IP addresses across all enabled AZs. But here's the key advantage—each individual public IP address is static. It doesn't change when you deploy new versions of your application, when you add or remove target instances, or even when you scale your infrastructure.

Let's say you have an NLB spanning three Availability Zones in us-east-1. You might see DNS resolution like this:

```
nlb-12345678.us-east-1.elb.amazonaws.com resolves to:
  203.0.113.10   (us-east-1a)
  203.0.113.20   (us-east-1b)
  203.0.113.30   (us-east-1c)
```

Each of those IP addresses is stable. You can put them on an allow-list in your firewall, and they'll remain valid for the lifetime of the load balancer.

### Elastic IPs: Bringing Your Own Address

Sometimes you need even more control over those IP addresses. Maybe your organization has already allocated a block of IP addresses from its own IP space, or you need to migrate from on-premises infrastructure and want to carry your existing IP addresses to AWS. This is where Elastic IPs come in.

An Elastic IP is a static public IP address that you can allocate and manage independently. Unlike the default public IP addresses that AWS assigns to an NLB, Elastic IPs remain associated with your account and can be moved between resources or released back to AWS.

With a Network Load Balancer, you can explicitly assign customer-managed Elastic IPs to each Availability Zone instead of letting AWS automatically allocate them. This is accomplished during NLB creation or modification through the AWS Management Console or the AWS CLI.

Here's how you might allocate and assign Elastic IPs via the CLI:

```bash
# Allocate three Elastic IPs (one per AZ)
aws ec2 allocate-address --domain vpc --region us-east-1
aws ec2 allocate-address --domain vpc --region us-east-1
aws ec2 allocate-address --domain vpc --region us-east-1

# This returns allocation IDs, which you'd then assign to your NLB
# during creation or via modify-load-balancer-attributes
```

The benefit here is predictability and portability. If you own these IP addresses (or your organization has reserved them), you maintain full control. You can document them in your compliance frameworks, add them to permanent firewall rules, and even plan to migrate them elsewhere if your infrastructure strategy changes.

### Common Scenarios Requiring Static IPs

Static IPs solve specific, real problems. Understanding these scenarios helps you recognize when you actually need them versus when they might be an unnecessary constraint.

**Legacy system integration** represents perhaps the most common use case. Imagine you're modernizing a monolithic application by gradually moving components to AWS. Your on-premises systems still need to communicate with AWS-based services, but they're hardcoded to connect to specific IP addresses. Rather than refactoring all that legacy code (a massive undertaking that carries risk), you can place an NLB with static IPs in front of your AWS workloads and update your on-premises firewall rules once. The NLB becomes a stable "landing zone" for traffic from your existing infrastructure.

**Regulatory and compliance requirements** are another significant driver. Financial institutions, healthcare providers, and government agencies often operate under frameworks that require knowing exactly where traffic originates and terminates. PCI DSS compliance, for instance, sometimes demands that certain communication channels use whitelisted IP addresses. A static IP on an NLB gives you a compliance anchor point—you can document it in your security controls, include it in audit reports, and prove that all traffic conforms to your established rules.

**Third-party firewall rules and access control lists** extend this further. If your application needs to connect to a partner's API, and that partner only allows traffic from pre-approved IP addresses, you need a predictable IP to provide them. Rather than having to constantly update their firewall rules as your infrastructure changes, a static NLB IP solves this in one configuration step.

**DNS-based access restrictions** occasionally come into play too. Some corporate networks only allow outbound connections to domains and IPs that have been pre-approved. If you're building an AWS application that needs to interact with such restricted networks, placing an NLB with a known static IP in front of your infrastructure gives those networks something concrete to allow.

### Architectural Pattern: NLB in Front of ALB

Here's an interesting—and somewhat counterintuitive—architectural pattern that leverages static IPs: placing an NLB in front of an Application Load Balancer.

At first, this seems redundant. Why add another layer of load balancing? The answer lies in requirements. You might have a modern HTTP/HTTPS application running behind an ALB (which provides excellent Layer 7 features like host-based routing, path-based routing, and advanced health checks), but you need static IP addresses for access control or regulatory compliance. An ALB doesn't provide this.

The solution is to create an NLB that forwards all traffic to your ALB. The NLB provides the static IP surface that external systems can rely on, while the ALB continues to provide all your application-layer load balancing and routing logic. The NLB essentially becomes a "static IP facade" for your ALB.

Here's a simplified view of this architecture:

```
External clients/systems
        ↓
  NLB (static IPs)
        ↓
  ALB (application routing)
        ↓
  Target instances
```

When you configure this, you'd set up the NLB to listen on TCP 443 (or whatever port you need) and forward to the ALB's ENI or IP address. The ALB listens on the same port and handles all the sophisticated routing logic.

This pattern does introduce an extra hop and slightly increases latency, but the tradeoff is worthwhile when compliance or legacy system requirements demand static IPs. The overhead is typically negligible—often just a millisecond or two—and it's far less expensive than maintaining a separate infrastructure or constantly updating firewall rules.

### Setting Up an NLB with Static IPs

Creating an NLB with static IP addresses is straightforward via the AWS Management Console. When you create a new NLB, you specify which Availability Zones to enable. For each AZ, you must select a subnet (which determines the VPC). The NLB will then automatically allocate an Elastic IP to that subnet in that AZ.

If you want to use customer-managed Elastic IPs instead, you allocate them first, then specify them during NLB creation or assign them afterward via the console or CLI.

Here's a practical example using the AWS CLI:

```bash
# Create an NLB with specific subnets (and automatic EIP allocation)
aws elbv2 create-load-balancer \
  --name my-static-nlb \
  --subnets subnet-12345678 subnet-87654321 \
  --type network \
  --scheme internet-facing \
  --region us-east-1
```

If you prefer to bring your own Elastic IPs:

```bash
# Allocate Elastic IPs first
eip_id_1=$(aws ec2 allocate-address --domain vpc --region us-east-1 --query 'AllocationId' --output text)
eip_id_2=$(aws ec2 allocate-address --domain vpc --region us-east-1 --query 'AllocationId' --output text)

# Then use them in your NLB configuration via the console
# Or via modify-load-balancer-attributes if the NLB already exists
```

Once created, you can verify the static IPs by describing the load balancer:

```bash
aws elbv2 describe-load-balancers \
  --load-balancer-arns arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/net/my-static-nlb/1234567890123456 \
  --region us-east-1
```

The output will show each AZ and its associated Elastic IP address, confirming that your static IPs are in place.

### Trade-offs and Considerations

Static IPs on an NLB aren't a universal solution, and there are important considerations before adopting this pattern.

First, remember that the NLB operates at Layer 4, not Layer 7. It's excellent for ultra-high performance and low-latency scenarios—it can handle millions of requests per second and supports protocols like UDP and non-HTTP TCP. But it doesn't understand HTTP concepts like hostnames, paths, or headers. If you need sophisticated application-layer routing, you'll either use an ALB (which doesn't have static IPs) or you'll need the NLB-in-front-of-ALB pattern discussed earlier, which adds complexity.

Second, Elastic IP addresses have costs. AWS charges a small hourly fee for Elastic IPs that aren't associated with a running resource, and there are per-region limits on how many you can allocate. If you're managing many NLBs across many regions, the costs and quota management can become a consideration.

Third, static IPs can sometimes create a false sense of simplicity. They're a band-aid on the real issue, which is often organizational—the legacy system needs updating, or the process for changing firewall rules needs improvement. In the long term, addressing the root cause is more important than working around it with static IPs. But in the short to medium term, static IPs are a pragmatic solution that lets you move forward.

Finally, consider the implications of having static IPs in a security context. An IP address that never changes is easier for attackers to target. You might want to pair your static NLB IPs with security groups, network ACLs, and AWS WAF rules to ensure that only legitimate traffic reaches your backend.

### When to Choose ALB vs. NLB for Static IPs

If you're torn between the Application Load Balancer and the Network Load Balancer and static IPs are a factor in your decision, here's how to think about it:

Choose an NLB with static IPs if you need ultra-high performance, low latency, or non-HTTP protocols, AND you need static IP addresses. The NLB is your only option here.

If you need static IP addresses for an HTTP/HTTPS application but want the Layer 7 routing capabilities of an ALB, use an NLB-in-front-of-ALB pattern. Yes, it adds a layer, but it's the right tool for that specific job.

If you don't need static IPs, strongly prefer the ALB for HTTP/HTTPS workloads. It's more feature-rich, easier to manage, and built specifically for application-layer concerns.

### Conclusion

The Network Load Balancer's ability to provide static IP addresses per Availability Zone addresses a real architectural need. Whether you're integrating legacy systems that expect stable IPs, meeting regulatory requirements, satisfying third-party firewall rules, or building a hybrid cloud infrastructure, the static IP feature offers a practical solution.

Understanding when static IPs genuinely matter—and when they might be an unnecessary constraint—is part of building robust, maintainable infrastructure. The NLB-in-front-of-ALB pattern shows how to combine static IPs with application-layer sophistication. And knowing your options—whether to let AWS allocate IPs automatically or to bring your own Elastic IPs—gives you the flexibility to design architectures that align with both technical requirements and organizational constraints.

As you design your AWS infrastructure, ask yourself whether static IPs are truly necessary or simply convenient. When they are necessary, the Network Load Balancer delivers them reliably, enabling you to bridge the gap between cloud agility and legacy system stability.
