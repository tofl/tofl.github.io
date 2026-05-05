---
title: "Cross-Zone Load Balancing in ALB and NLB: How It Affects Traffic Distribution and Cost"
---

## Cross-Zone Load Balancing in ALB and NLB: How It Affects Traffic Distribution and Cost

Load balancers sit at the front door of your application, and how they route traffic can dramatically affect both performance and your AWS bill. One feature that often catches developers off guard is cross-zone load balancing—a seemingly simple toggle that controls whether your load balancer distributes traffic evenly across availability zones or stays local to each zone. Understanding this feature is essential not just for cost optimization, but for building resilient, fairly-balanced applications.

In this article, we'll explore what cross-zone load balancing does, why AWS chose different defaults for different load balancer types, and most importantly, how to make the right decision for your specific workload.

### Understanding the Basics of Load Balancer Architecture

Before diving into cross-zone load balancing, it's worth understanding how load balancers are architected in AWS. When you create an Application Load Balancer (ALB) or Network Load Balancer (NLB), AWS doesn't give you a single machine sitting in a data center. Instead, it provisions load balancer nodes in each availability zone where you've enabled the load balancer.

Think of this like having regional distribution centers. If you're shipping packages, you don't want all shipments to come from one warehouse. By spreading load balancer nodes across multiple AZs, AWS ensures fault tolerance—if one AZ goes down, your remaining nodes continue serving traffic.

However, this distributed architecture creates an interesting problem: what happens when you have more targets in one AZ than another? Or when traffic patterns don't align perfectly with your target distribution? This is where cross-zone load balancing enters the picture.

### What is Cross-Zone Load Balancing?

Cross-zone load balancing is a feature that determines how each load balancer node distributes incoming requests. When cross-zone load balancing is **enabled**, each load balancer node distributes traffic evenly across all registered targets in all availability zones. When it's **disabled**, each load balancer node distributes traffic only to targets registered in the same availability zone.

Let's make this concrete with an example. Imagine you have an ALB with three availability zones, and you've registered six targets total: four EC2 instances in us-east-1a and two EC2 instances in us-east-1b.

**With cross-zone load balancing enabled**, when a request arrives at the load balancer node in us-east-1a, it doesn't prioritize the four local targets. Instead, it has an equal chance of routing to any of the six targets across both zones. The same applies to the load balancer node in us-east-1b—it will also distribute across all six targets.

**With cross-zone load balancing disabled**, the load balancer node in us-east-1a routes only to its local targets (the four instances in us-east-1a), and the load balancer node in us-east-1b routes only to its two local targets. If traffic happens to hit the load balancer node in us-east-1a more heavily, those four instances bear the burden, while the two instances in us-east-1b may be underutilized.

### The ALB vs. NLB Default Behavior

This is where AWS's design choices reveal themselves. The two major load balancer types have different defaults for cross-zone load balancing, and understanding why requires thinking about typical use cases and cost implications.

**Application Load Balancers (ALBs)** have cross-zone load balancing **enabled by default**, and critically, there is **no charge** for inter-AZ data transfer when you use it. ALBs are typically used for web applications, microservices, and scenarios where even traffic distribution across availability zones is desirable. The free inter-AZ data transfer encourages users to enable this feature, leading to more balanced, resilient applications. For most developers, this default makes sense—you get better distribution at no extra cost.

**Network Load Balancers (NLBs)** and **Gateway Load Balancers (GWLBs)** have cross-zone load balancing **disabled by default**, and there **is a charge** for inter-AZ data transfer when you enable it. NLBs are designed for extreme performance scenarios—ultra-high throughput, low latency, and millions of requests per second. In these performance-critical environments, the cost of inter-AZ data transfer matters significantly. By defaulting to disabled, AWS lets performance-focused users opt out of the cost unless they explicitly need cross-zone distribution.

This design reflects different priorities: ALBs prioritize even distribution and resilience (with free inter-AZ transfer), while NLBs prioritize raw performance and cost control (charging for inter-AZ transfer).

### The Problem with Uneven Target Distribution

Let's walk through a real scenario to illustrate why cross-zone load balancing matters. Suppose you're running a production web application with an ALB. You've provisioned targets across three availability zones, but due to scaling patterns and team decisions, you ended up with an uneven distribution:

- us-east-1a: 8 instances
- us-east-1b: 4 instances  
- us-east-1c: 2 instances

Now, suppose you decide to disable cross-zone load balancing on your ALB (perhaps to save costs, or due to a misunderstanding of the defaults). What happens?

The load balancer node in us-east-1a receives an incoming request. It dutifully distributes it among the 8 local instances. Meanwhile, the load balancer node in us-east-1c receives a request and has to distribute it among just 2 instances. If traffic is evenly split between the three load balancer nodes, then each instance in us-east-1c is handling 4x as much traffic per instance compared to those in us-east-1a.

This is a hotspot. The two instances in us-east-1c will hit CPU limits, experience longer latency, and potentially fail while the instances in us-east-1a remain underutilized. Your application's performance is bottlenecked by its smallest AZ.

With cross-zone load balancing enabled, traffic is distributed evenly across all 14 instances regardless of which AZ each request hits. The load balancer nodes collaborate, in a sense, to ensure fair distribution. Each instance handles roughly the same load, and you get better resource utilization and more predictable performance.

### Cost Implications and When They Matter

For ALBs, the decision is usually straightforward: keep cross-zone load balancing enabled. The inter-AZ data transfer is free, and you get better distribution as a bonus.

For NLBs, the math becomes more interesting. AWS charges for inter-AZ data transfer at the standard data transfer rate (typically $0.02 per GB as of recent pricing, though you should verify current rates in your region). If you have an NLB processing 100 GB of traffic per day, and 50% of that traffic crosses availability zones due to cross-zone load balancing, you're looking at roughly $30 per month in additional charges.

Whether this cost is worth paying depends on your architecture. If you have an even distribution of targets across AZs and receive traffic randomly, cross-zone load balancing may transfer more data than necessary. But if your targets are unevenly distributed or you need consistent performance regardless of target distribution, the cost becomes an investment in reliability.

Consider also that data transfer costs scale with volume. A high-frequency trading platform using an NLB for sub-millisecond performance might process terabytes of data monthly. For such workloads, the decision to enable cross-zone load balancing requires careful cost-benefit analysis. Conversely, a small NLB handling a few hundred GB monthly might find the cost negligible compared to the operational simplicity and resilience benefits.

### Enabling and Disabling Cross-Zone Load Balancing

Cross-zone load balancing is configured at the target group level, not at the load balancer level. This is an important detail—different target groups attached to the same load balancer can have different cross-zone settings.

To enable or disable cross-zone load balancing using the AWS CLI, you modify the target group attributes. Here's an example:

```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-targets/1234567890abcdef \
  --attributes Key=load_balancing.cross_zone.enabled,Value=true
```

To disable it:

```bash
aws elbv2 modify-target-group-attributes \
  --target-group-arn arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/my-targets/1234567890abcdef \
  --attributes Key=load_balancing.cross_zone.enabled,Value=false
```

If you're using the AWS Management Console, navigate to your target group, click the "Edit attributes" button, and toggle "Cross-zone load balancing" on or off. The change takes effect immediately without requiring you to recreate the target group or restart your application.

### Practical Considerations for Different Workload Types

**Web Applications and Microservices**: If you're running a typical web application with an ALB, leave cross-zone load balancing enabled. The even distribution ensures that a failure or scaling event in one AZ doesn't create hotspots in others. This is the path of least resistance and provides the best default behavior.

**High-Performance APIs**: For NLB-based APIs that need predictable, ultra-low latency, evaluate whether your targets are evenly distributed. If you have roughly equal targets in each AZ and traffic arrives evenly distributed, disabling cross-zone load balancing reduces inter-AZ data transfer and keeps traffic local. If distribution is uneven, enabling it prevents hotspots despite the cost.

**Stateful Services**: If your targets maintain session state or local caches, keeping traffic local to an AZ (by disabling cross-zone) can improve cache hit rates and reduce network overhead. This is especially relevant for services using local Redis instances or session stores co-located with your application servers.

**Database Connectivity**: For applications using connection pools that prefer local database replicas, disabling cross-zone load balancing ensures requests stay within the same AZ, avoiding unnecessary inter-AZ data transfer and potential latency from region-spanning network calls.

### Monitoring and Observability

When you make changes to cross-zone load balancing, how do you know if it's working as intended? AWS CloudWatch provides metrics for monitoring load balancer behavior.

For ALBs and NLBs, pay attention to the `ActiveConnectionCount` and `TargetResponseTime` metrics. If you disable cross-zone load balancing and see response times spike or connection counts become uneven across targets, that's a signal that your target distribution is uneven and cross-zone load balancing would help.

Also monitor your AWS billing. If you enable cross-zone load balancing on an NLB, you'll see inter-AZ data transfer costs appearing in your bill under "EC2-DataTransfer" charges. Track this over a few weeks to understand the actual impact.

### Common Misconceptions

One frequent mistake is assuming that enabling cross-zone load balancing on an NLB will dramatically increase costs. While there is a charge, the actual impact depends entirely on your traffic patterns and target distribution. If you already have reasonably even target distribution and traffic patterns, the additional cost may be surprisingly small.

Another misconception is that cross-zone load balancing is "all or nothing." Remember, it's configured per target group. You can have one target group with cross-zone enabled (for fault tolerance) and another with it disabled (for cost control), both attached to the same load balancer.

Finally, some developers think that cross-zone load balancing is only relevant when targets are unevenly distributed. In reality, even with even distribution, traffic patterns may not be perfectly balanced across load balancer nodes. Cross-zone load balancing smooths out these variations and ensures more predictable performance.

### The Bigger Picture: Resilience vs. Cost

At its heart, the cross-zone load balancing feature embodies a fundamental tension in cloud architecture: resilience versus cost. AWS's different defaults for ALB and NLB reflect this tension.

ALBs default to maximum resilience (cross-zone enabled, free inter-AZ transfer) because most web applications benefit from even distribution and don't require extreme performance. NLBs default to maximum cost control (cross-zone disabled, charged for inter-AZ transfer) because their users often have specialized performance requirements and want granular control over every penny spent.

For your applications, the right decision depends on your specific context. Ask yourself: How sensitive is my application to uneven load distribution? How much would a hotspot in one AZ impact my users? How much would inter-AZ data transfer costs impact my budget? The answers will guide you toward the right setting.

### Conclusion

Cross-zone load balancing is a deceptively important feature that affects both how fairly your traffic is distributed and how much you pay for that distribution. By understanding that ALBs enable it by default (with free inter-AZ transfer) while NLBs disable it by default (with charged inter-AZ transfer), you'll make better architectural decisions.

The key takeaway is this: cross-zone load balancing is not a set-it-and-forget-it feature. It deserves consideration whenever you're designing load balancer configurations, especially when targets are unevenly distributed across availability zones or when costs matter to your budget. Monitor your target group behavior, understand your traffic patterns, and adjust the setting based on your actual needs rather than assumptions.

Whether you enable or disable it, making a conscious choice based on understanding rather than accident is what separates thoughtful architecture from lucky guesses.
