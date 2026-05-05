---
title: "Comparing Reserved Instances and Savings Plans: Standard, Convertible, Compute, and EC2 Instance Plans"
---

## Comparing Reserved Instances and Savings Plans: Standard, Convertible, Compute, and EC2 Instance Plans

AWS offers several ways to reduce your compute costs through upfront commitments. If you've ever looked at your EC2 bill and thought "there has to be a better way than on-demand pricing," you're right. But choosing between Reserved Instances and Savings Plans can feel like navigating a maze of trade-offs between discount rates, flexibility, and commitment duration.

The good news is that these options aren't mysterious. Each serves a specific purpose, and understanding when to use each one will save you thousands of dollars—and more importantly, will help you architect cost-efficient solutions that actually meet your business needs. Let's break down how these commitment-based pricing models work, what makes each one special, and how to decide which is right for your workloads.

### Understanding AWS Commitment-Based Pricing

Before diving into the specifics of each option, it's worth understanding why AWS created multiple commitment models in the first place. On-demand pricing is expensive because you're paying a premium for absolute flexibility—you can launch or terminate instances at any moment without penalty. But if AWS knows you'll keep an instance running for a year or three years, they're willing to offer you a significant discount in exchange for that predictability.

The question is: how much flexibility do you need, and how much discount are you willing to forgo to get it? Different workloads have different answers to that question, and AWS designed these options to address the full spectrum.

### Reserved Instances: The Traditional Commitment Model

Reserved Instances, or RIs, are AWS's original solution for reducing compute costs through commitments. When you purchase a Reserved Instance, you're essentially making a contractual promise to AWS: "I will run an instance with these specific attributes for the next one or three years." In exchange, you receive a significant discount—typically 40% off on-demand pricing for a one-year commitment, and up to 72% off for a three-year commitment if you pay all upfront.

The critical word here is *specific*. A Standard Reserved Instance is locked to a particular instance type, availability zone (or region, depending on your scope), operating system, and tenancy. If you purchase a Standard RI for a t3.medium running Linux in us-east-1a, you're committing to that exact configuration.

#### Standard Reserved Instances: Maximum Discount, Maximum Constraint

Standard RIs offer the deepest discounts AWS provides for compute commitments. If you have workloads that truly never change—perhaps a database server or a long-running application tier that you know will run for years with the same instance type—Standard RIs are your friend.

The discount structure works like this: you can choose to pay all upfront (highest discount), partial upfront (moderate discount), or no upfront (smallest discount but spread costs over the year or three years). A three-year all-upfront Standard RI might give you 72% off on-demand pricing, while a one-year no-upfront RI might give you 25% off. These percentages vary by region and instance type, but the pattern holds: longer commitment and more upfront payment equals deeper discount.

The trade-off is flexibility. If you need to change instance types, move to a different availability zone, switch operating systems, or change from shared tenancy to dedicated tenancy, you can't easily do so. You're stuck with what you purchased, unless you sell your RI on the Reserved Instance Marketplace, which is AWS's secondary market for unused capacity.

Consider a real-world example: you're running a critical application that requires a consistent amount of compute capacity. You've been monitoring your usage for six months, and you know you need exactly four m5.xlarge instances in us-east-1 running Linux. You expect this requirement to remain stable for the next three years. A Standard RI is a perfect fit. You purchase four three-year m5.xlarge RIs all upfront, and you lock in a 72% discount for three years of completely predictable costs.

#### Convertible Reserved Instances: Trading Discount for Flexibility

Convertible Reserved Instances address one of the biggest complaints about Standard RIs: what if your workload requirements change? Convertible RIs allow you to exchange your instance commitment for a different instance type, family, operating system, or tenancy—as long as the new instance doesn't have a *lower* total list price than your original commitment.

The discount on Convertible RIs is lower than Standard RIs—typically around 54% off on-demand pricing for a three-year all-upfront commitment, compared to 72% for Standard. That 18 percentage point difference is the flexibility premium you're paying. AWS is saying, "We'll give you a good discount, but not as deep as if you were locked in completely."

The flexibility mechanism works on a value basis. If you purchase a Convertible RI for an m5.xlarge and later want to switch to a c5.2xlarge (which has a higher hourly list price), AWS will let you do it. The RI value stays the same, but now it covers more of your c5.2xlarge hours. Conversely, if you want to downsize to a t3.small, AWS won't stop you, but your RI value won't be recalculated—you'll lose the value difference, in effect.

This makes Convertible RIs particularly useful for development teams or businesses in growth phase, where instance type requirements might shift over time. It's also valuable if you're unsure whether an instance type will meet your needs in the future, or if you plan to optimize for cost or performance as your application matures.

Here's a practical scenario: you're building a new microservice architecture and you've estimated you'll need roughly 16 ECUs of compute capacity. You think an m5.large might work, but you're not 100% certain whether you'll need the memory of an m5 or if you could get away with a c5. A Convertible RI lets you commit to the 16 ECU value without being locked into the exact instance family. If you later discover that a c5 is sufficient and more cost-effective, you can convert to c5 instances, and AWS handles the conversion automatically based on the pricing relationship.

### Savings Plans: The Modern, Flexible Commitment Model

Savings Plans represent AWS's evolution in commitment-based pricing. Rather than locking you into a specific instance configuration, Savings Plans lock you into a specific hourly spend commitment across a category of compute services. This shift from "instance type" to "hourly spending" fundamentally changes the flexibility equation.

Savings Plans come in two primary flavors: Compute Savings Plans and EC2 Instance Savings Plans. Both offer discounts relative to on-demand pricing, but they differ significantly in their scope and flexibility.

#### Compute Savings Plans: Maximum Flexibility Across Services

Compute Savings Plans represent the most flexible commitment option AWS offers. When you purchase a Compute Savings Plan, you're committing to spend a certain amount per hour on eligible compute services. That commitment can be applied to:

- EC2 instances (any family, any size, any region, with some caveats)
- AWS Fargate (serverless container compute)
- AWS Lambda (serverless functions)

The discount is typically around 17% off on-demand pricing for a one-year commitment and around 34% off for a three-year commitment. That's less than Reserved Instances, but the flexibility is remarkable. You could run your workload entirely on EC2 this month, shift partially to Fargate next month, and add some Lambda functions the month after that—and your Compute Savings Plan commitment covers all of it, automatically applied by AWS's billing system.

The key constraint is that it's a regional commitment. A Compute Savings Plan applies to compute usage in a specific region (or you can choose to apply it across all regions, though that's slightly less efficient). Within that region, you have complete flexibility on instance type, family, size, and even service.

Compute Savings Plans shine for organizations with evolving architectures or businesses experimenting with different compute paradigms. If you're transitioning from traditional EC2-based applications to a containerized infrastructure with Fargate, or if you're building new serverless functions alongside existing EC2 workloads, a Compute Savings Plan covers all of it seamlessly.

Picture this scenario: you run a SaaS platform with varying workload patterns. During peak hours, you spin up additional EC2 instances for processing. Some of your workloads are containerized and run on Fargate. And you use Lambda for certain scheduled jobs and event-driven tasks. With a Compute Savings Plan, you can commit to a fixed hourly spend across all three services. AWS automatically applies your commitment to whichever service is running at any given time, in the region you selected. Your billing becomes simpler, and you maintain maximum flexibility.

#### EC2 Instance Savings Plans: Region and Family Lock-in with Higher Discounts

EC2 Instance Savings Plans occupy the middle ground between Standard Reserved Instances and Compute Savings Plans. They lock you into a specific region and instance family, but they give you flexibility within that scope—you can run any size or generation of the instance family, and AWS automatically applies your commitment to whichever size you're running.

The discount is typically around 20% for a one-year commitment and around 40% for a three-year commitment—higher than Compute Savings Plans, but lower than Standard RIs. You're trading some flexibility for a deeper discount compared to Compute Savings Plans.

The typical use case is when you know you'll consistently use a specific instance family in a specific region, but you want some flexibility on sizing. For example, you might know you'll always need m5 instances in us-east-1, but your application can run on either m5.large or m5.xlarge depending on load. An EC2 Instance Savings Plan for the m5 family in us-east-1 automatically applies to whatever size you're running.

Let's say you're running a web application tier that always uses m5 instances in your primary region. You know you'll never move to a different instance family (c5 is insufficient for your memory requirements, and t3 is too small), and you'll never relocate to a different region. An EC2 Instance Savings Plan for m5 instances in that region gives you better pricing than a Compute Savings Plan, without the inflexibility of a Standard RI.

### The AWS Billing System: How Commitments Are Applied

One of the most important concepts to understand is how AWS automatically applies your commitments to your actual usage. This isn't something you have to manually manage—AWS's billing system does it for you. But understanding the logic helps you make better decisions about which commitment types to purchase.

When you incur compute charges in AWS, the billing system applies them in a specific order:

1. **Committed capacity is consumed first.** Any Reserved Instance or Savings Plan commitment automatically reduces your charge for matching usage. AWS doesn't require you to explicitly assign RIs or Savings Plans to instances—it just happens automatically based on attributes.

2. **RIs are applied based on matching attributes.** A Standard RI for an m5.large in us-east-1a applies only to m5.large instances running in that exact availability zone. A Convertible RI can be applied more broadly but still requires matching (or higher-value) instance attributes. An EC2 Instance Savings Plan for m5 in us-east-1 applies to any m5 size in that region. A Compute Savings Plan applies to any eligible compute service in that region.

3. **On-demand rates apply to anything not covered.** Once your commitments are exhausted, you pay on-demand pricing for any additional usage.

This automatic application is powerful because it means you don't have to plan perfectly. If you purchase an m5 EC2 Instance Savings Plan for $2/hour and you run m5.large instances for one hour and m5.xlarge instances for one hour, AWS automatically applies your $2/hour commitment across both, and you pay on-demand rates for any overage.

However, this also means that if your commitment doesn't match your actual usage patterns, you'll still pay on-demand rates for the mismatch. If you purchase a Standard RI for an m5.large in us-east-1a, but you only run m5.large instances in us-east-1b, your RI is wasted—it doesn't apply to your usage, and you pay full on-demand rates. This is why flexibility in commitment options matters so much.

### Mixing and Matching Commitment Types

AWS doesn't force you to choose just one commitment type—you can mix Reserved Instances and Savings Plans in the same account and region. In fact, most sophisticated AWS users do exactly that.

The strategy typically looks like this: for stable, predictable workloads with fixed configurations, use Standard RIs or Convertible RIs to maximize discount. For workloads that vary in size or type, or for services like Fargate and Lambda, use Savings Plans. This hybrid approach gives you the deepest possible discounts while maintaining the flexibility you need for dynamic workloads.

For example, imagine you run a SaaS platform with two distinct workload types. Your database tier requires eight m5.2xlarge instances in us-east-1 running 24/7—completely stable and predictable. Your application tier requires variable numbers of t3 instances depending on load, and you're experimenting with running some workloads on Fargate. For the database tier, purchase Standard RIs for eight m5.2xlarge instances—maximum discount for a workload that never changes. For the application tier and Fargate workloads, purchase a Compute Savings Plan to cover both, giving you flexibility to shift between instance types and services as your architecture evolves.

When you mix commitment types, AWS applies them in order of specificity. Reserved Instances (whether Standard or Convertible) are applied first because they're more specific. Then Savings Plans are applied. Then any remaining usage is charged at on-demand rates.

### Decision Matrix: Choosing the Right Commitment

The decision logic can feel complex, so let's build a practical framework for choosing between these options.

**Use Standard Reserved Instances when:**
- Your workload is completely static—same instance type, same region, same OS, same tenancy for years
- You want the maximum possible discount
- You're willing to lose all flexibility
- Your usage pattern is predictable and stable

Standard RIs are ideal for baseline workloads like dedicated database servers, persistent caching layers, or core infrastructure that never changes.

**Use Convertible Reserved Instances when:**
- You want a good discount but need flexibility to change instance types or families
- You're unsure about long-term instance type requirements
- You expect instance type optimization over time
- You might change OS or tenancy but want to keep regional scope

Convertible RIs work well for new workloads where you're still optimizing, or for applications that might benefit from hardware evolution over a three-year period.

**Use EC2 Instance Savings Plans when:**
- You know you'll always use the same instance family in the same region
- You want flexibility on instance size within that family
- You want a discount deeper than Compute Savings Plans
- Your workload is sized-variable but family-stable

EC2 Instance Savings Plans are perfect for applications that scale horizontally within a family, like auto-scaling groups that might need anywhere from three to twenty m5 instances.

**Use Compute Savings Plans when:**
- You have multiple types of compute services in the same region
- You want maximum flexibility across EC2, Fargate, and Lambda
- You're willing to accept a smaller discount than RIs for that flexibility
- Your architecture is evolving or experimental

Compute Savings Plans excel in modern, multi-service architectures where you're not locked into a single service paradigm.

A practical example: imagine you're architecting a platform that needs persistent batch processing (perfect for EC2), some bursty request-based workloads (suitable for Fargate), and event-driven automation (ideal for Lambda). A Compute Savings Plan covers all three, automatically applying your commitment to whichever service is consuming resources at any moment. Later, if you discover that batch processing could move to Fargate, you don't need to adjust your commitment—it simply gets applied to Fargate instead of EC2. That flexibility is worth more to most organizations than the slightly deeper discount you'd get from a Standard RI.

### Capacity Reservations: A Complementary Tool

While not a commitment-based pricing option, Capacity Reservations deserve mention because they work alongside Reserved Instances and Savings Plans. A Capacity Reservation guarantees that AWS will hold specific instance capacity for you in a particular availability zone. They're not discount mechanisms—you still pay on-demand rates for instances you run, or a small hourly fee for unused reserved capacity.

Capacity Reservations exist to solve a different problem: availability. In regions with high demand, you might not be able to launch an instance because that instance type is sold out in your availability zone. A Capacity Reservation ensures AWS keeps capacity available for you, even if you don't use it. You'd typically use a Capacity Reservation for critical production workloads in high-demand regions, then pair it with a Savings Plan or RI to get discount coverage.

### Optimization in Practice

Real AWS environments rarely involve buying a commitment and forgetting about it. As your workload evolves, your commitment strategy should evolve too. Here's how sophisticated teams approach this:

First, they monitor actual usage patterns for several weeks or months before committing. "If we always use eight m5.large instances, let's commit to it," they might say. But they also look at variance. "If we use anywhere from five to twelve m5.large instances depending on season, maybe an EC2 Instance Savings Plan is better than eight Standard RIs, because we can handle the variable sizing."

Second, they set reservation purchase policies. Many teams reserve 60-70% of expected baseline usage, leaving 30-40% on-demand for spikes and unexpected growth. This balances cost savings with flexibility.

Third, they regularly review their commitments. AWS provides detailed reports on commitment utilization. If you have a Savings Plan or RI that's barely being used, that's a signal that your workload has changed and your commitment strategy should adapt.

Fourth, they build commitment recommendations into their infrastructure-as-code practices. When provisioning infrastructure, teams note "this is stable baseline workload, recommend Standard RI" or "this is variable workload, recommend Compute Savings Plan." This helps finance and procurement teams make informed purchase decisions.

### Common Pitfalls to Avoid

Understanding the nuances of commitment-based pricing helps you avoid expensive mistakes. Here are the most common pitfalls:

**Buying commitments without understanding actual usage.** Purchasing a Standard RI for an instance type you think you'll use, only to discover three months later that your architecture changed and you're running a different instance type, wastes your commitment. Always validate usage patterns before committing.

**Choosing the wrong scope.** An EC2 Instance Savings Plan with regional scope is more efficient than one with zonal scope, unless you have a specific reason to bind to an availability zone. Generally, prefer broader scopes when available.

**Overcommitting to discounts.** A 72% discount on a three-year commitment is attractive, but only if you're certain about your needs. Many organizations are more nimble than they realize—they upgrade instance types, migrate to different services, or change regions as they grow. A shallower discount with more flexibility often makes financial sense.

**Ignoring Compute Savings Plans for multi-service architectures.** Some teams keep Compute Savings Plans as an afterthought because they offer lower discounts than RIs. But in organizations with EC2, Fargate, and Lambda workloads, the flexibility of Compute Savings Plans often outweighs the slightly higher effective cost.

**Letting commitments expire unused.** If you have a Savings Plan or RI that's not being consumed, it's pure waste. Monitor utilization and adjust your infrastructure or commitment mix accordingly.

### Conclusion

AWS's commitment-based pricing options exist on a spectrum from maximum discount with minimum flexibility (Standard RIs) to maximum flexibility with moderate discounts (Compute Savings Plans). There's no universally right answer—the right choice depends on your workload stability, your architecture diversity, and your willingness to trade flexibility for savings.

The key insight is that modern applications often benefit from a hybrid approach. Use Standard RIs for truly stable workloads, Convertible RIs for workloads that might evolve, EC2 Instance Savings Plans for sized-variable but family-stable workloads, and Compute Savings Plans for multi-service architectures. Monitor your utilization, review your commitments quarterly, and adjust as your business and technology evolve.

By understanding how AWS's billing system automatically applies commitments, and by choosing commitment types that align with your actual workload characteristics, you can reduce your compute costs by 40-72% while maintaining the flexibility your organization needs to innovate and scale.
