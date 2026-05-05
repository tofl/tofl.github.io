---
title: "ENI Limits and IP Address Planning for Fargate at Scale"
---

## ENI Limits and IP Address Planning for Fargate at Scale

When you launch your first few Fargate tasks, networking feels straightforward: AWS handles the infrastructure, you point to a subnet, and things just work. But as you scale toward dozens, hundreds, or thousands of concurrent tasks, that simplicity can mask a critical constraint hiding beneath the surface. Every single Fargate task consumes one Elastic Network Interface (ENI) and claims one private IP address from your subnet. Scale that up, and you're no longer dealing with a nice-to-have architectural consideration—you're wrestling with a hard limit that can silently derail your deployment.

This article cuts through the abstraction layer and shows you exactly what's happening at the network level when Fargate tasks run, how to calculate the IP space you actually need, and how to architect your VPC and subnet strategy to scale reliably. We'll cover the ENI quotas AWS imposes per region, walk through practical CIDR planning exercises, and explore the patterns that keep large Fargate deployments running smoothly even under load.

### Understanding the Fargate and ENI Relationship

Fargate's greatest strength is also the source of this constraint: it abstracts away the EC2 instance entirely and lets you think only about your application containers. But that abstraction doesn't eliminate the underlying networking reality—it just pushes it into the background.

When you create a Fargate task, AWS allocates an ENI specifically for that task. That ENI gets attached to the subnet you specified in your task definition or service configuration. The ENI is assigned one private IP address from that subnet's CIDR block, and optionally one or more secondary private IPs and public IPs if you configure them. Crucially, this is a one-to-one relationship: one task, one ENI, at least one IP address consumed from your subnet.

This matters because ENIs are a regional resource with per-region quotas, and IP addresses within a subnet are finite. Unlike EC2 instances, where a single host might run multiple containers sharing the same network interface, Fargate enforces a hard architectural boundary: each task gets its own ENI.

The awsvpc network mode—which is the only network mode available for Fargate—is key here. Unlike the bridge or host modes available in EC2-hosted ECS, awsvpc means the task's container ports are directly mapped to the ENI's private IP. When your application listens on port 8080 inside the container, it's accessible at `<task_eni_private_ip>:8080` on the VPC network. This design simplifies networking at the cost of consuming dedicated network infrastructure per task.

### ENI Quotas and Regional Limits

AWS enforces per-region quotas on the number of ENIs you can create. For most accounts, the default limit is 350 ENIs per region. This is a soft quota, meaning you can request an increase through AWS Support, but it's the ceiling you'll hit before needing an exception.

At first glance, 350 might sound like plenty. But let's do the math: if you're running a Fargate service with 200 tasks, you're consuming 200 ENIs right there. Add a couple of other services, some EC2 instances for bastion hosts or data processing, NAT gateways (which each consume one ENI), load balancer network interfaces, and RDS database instances (which also use ENIs), and you can find yourself dangerously close to that limit without even realizing it.

The quota applies at the region level, not per subnet or AZ. If you're deploying a truly large application across multiple Fargate services, multiple subnets, and multiple availability zones within a single region, all those ENIs draw from the same pool.

Here's a practical example: imagine you're running a microservices architecture with five services: an API service targeting 150 tasks, a worker service targeting 100 tasks, a batch processor targeting 50 tasks, and two smaller supporting services with 20 tasks each. That's 340 tasks consuming 340 ENIs. You've now used 97% of your default quota. If you need to perform a rolling update that temporarily doubles one service's task count, or if you're running development and staging environments in the same region, you'll exceed the limit and deployments will fail.

The failure mode is subtle and frustrating: your ECS task definition is valid, your service configuration is correct, but when AWS tries to place a new task, it can't allocate an ENI because you've hit the regional limit. You'll see the task stuck in a `PROVISIONING` state indefinitely, and if you dig into the task events, you'll find a message about being unable to allocate a network interface.

The solution is twofold. First, understand your current consumption by checking CloudWatch metrics or by querying your VPC resources to count active ENIs. AWS provides a quota dashboard in the Service Quotas console where you can see your current ENI usage against your limit. Second, plan for growth and request a quota increase well before you need it. AWS typically grants increases from 350 to several thousand without much friction, but it takes a few days for the increase to propagate, so don't wait until you're in an outage.

### Subnet CIDR Planning: The IP Address Math

While the ENI quota is a regional ceiling, the more immediate constraint for many deployments is IP address exhaustion within a subnet. Each Fargate task consumes one private IP address from the subnet's CIDR block, and once those addresses are gone, no new tasks can launch in that subnet—regardless of whether you have capacity elsewhere.

Let's walk through the realities of subnet IP planning. A `/24` CIDR block (for example, `10.0.1.0/24`) contains 256 IP addresses. However, AWS reserves four addresses in every subnet: the network address, the broadcast address, and two additional addresses for AWS infrastructure. That leaves 252 usable IP addresses.

If your subnet runs a Fargate service with 250 concurrent tasks, you've consumed 250 of those 252 usable IPs. You're out of capacity. New task launches will fail with a "no IP addresses available in the subnet" error. This isn't a graceful degradation—your deployment simply stops scaling.

Many developers and architects underestimate how quickly subnets fill up, especially in modern, containerized workloads where the number of tasks can scale dynamically based on demand. A microservice that handles 50 concurrent requests might spin up 100 tasks when traffic spikes. A batch job might launch 500 tasks in parallel. If your subnet planning doesn't account for these peaks, you'll hit the IP ceiling during the very moment when your application is under the most stress.

The calculation is straightforward but easy to get wrong. Start with your expected maximum concurrent tasks at any given time, then add a buffer for rolling updates (typically 50% of your task count), then add buffers for any other resources that might consume IPs in the same subnet (RDS instances, ElastiCache nodes, or other EC2 resources). Finally, increase that total by 20% to account for future growth and headroom.

For example, if you're running an API service with a target of 100 tasks and a rolling update strategy that allows 50% over-provisioning, you need 150 IPs at peak update time. Add 20 IPs for miscellaneous resources and future growth, and you're at 170 IPs needed. A `/24` subnet with 252 usable IPs would work, but it's tight. A `/23` subnet (which provides 508 usable IPs) gives you comfortable headroom and room to grow.

But here's the catch: VPC subnets can't be resized once created. You can't take a `/24` and expand it to a `/23` without recreating the subnet, which means draining all resources from it first. This is why planning the CIDR block size upfront is critical.

### Designing Subnet Topology for Large Deployments

As your Fargate workload grows, running everything in a single subnet becomes increasingly risky. A single subnet has a single IP pool, a single set of route tables, and a single availability zone. If that subnet fills up or if that AZ experiences issues, your entire application is impacted.

The better approach is to distribute tasks across multiple subnets spanning multiple availability zones. This achieves several things simultaneously: it spreads the IP address consumption across multiple CIDR blocks, it provides availability zone redundancy, and it gives you explicit control over task placement policies.

A typical pattern for a production Fargate application uses at least three subnets, one per availability zone within a region. If you're in `us-east-1`, you might have subnets in `us-east-1a`, `us-east-1b`, and `us-east-1c`. Each subnet could be a `/24` (252 IPs) or larger depending on your workload size.

When you define an ECS service, you specify a list of subnets in the network configuration:

```json
{
  "networkConfiguration": {
    "awsvpcConfiguration": {
      "subnets": [
        "subnet-12345678",
        "subnet-87654321",
        "subnet-aaaabbbb"
      ],
      "assignPublicIp": "ENABLED"
    }
  }
}
```

ECS will distribute tasks across these subnets according to its placement logic. By default, ECS attempts to balance tasks evenly across subnets, but the exact distribution depends on how many tasks are running and whether any subnets have exhausted their IP addresses. If one subnet runs out of IPs, ECS will place all new tasks in the remaining subnets.

The advantage of this multi-subnet approach is resilience. If one subnet exhausts its IP pool, tasks can still launch in others. If one AZ experiences an outage, your service continues running in the other AZs. But the disadvantage is operational complexity: you now have to manage CIDR blocks across multiple subnets and ensure they don't overlap.

### Practical CIDR Planning Exercise

Let's work through a real scenario. You're planning a Fargate deployment for a three-tier application: a frontend API service, a backend processing service, and a data synchronization service. The application is deployed in a single region across three availability zones.

Your requirements are:

- Frontend API: target 80 tasks, with 50% over-provisioning during updates, plus 20 IPs for load balancer and miscellaneous resources
- Backend processor: target 120 tasks, with 50% over-provisioning, plus 20 IPs for RDS and other infrastructure
- Data sync service: target 60 tasks, with 50% over-provisioning, plus 10 IPs for headroom

Let's calculate the IP needs for each service:

Frontend API: (80 × 1.5) + 20 = 140 IPs needed
Backend processor: (120 × 1.5) + 20 = 200 IPs needed
Data sync service: (60 × 1.5) + 10 = 100 IPs needed

If you deployed all three services to the same subnet, you'd need 440 IPs total. A single `/23` provides 508 IPs, which would barely fit. But if one service scales unexpectedly or you add another service later, you're in trouble.

Instead, distribute across three subnets (one per AZ). Each subnet now needs to accommodate the worst-case scenario for any single service. The backend processor is your largest service at 200 IPs, so each subnet should support at least 200 IPs comfortably. A `/24` provides 252 IPs, which works but doesn't leave much room. A `/23` provides 508 IPs and is safer.

Your VPC might use `10.0.0.0/16` as its CIDR block. You could allocate:

- `10.0.1.0/23` (AZ-a) — 508 usable IPs
- `10.0.3.0/23` (AZ-b) — 508 usable IPs
- `10.0.5.0/23` (AZ-c) — 508 usable IPs

This leaves you with `10.0.7.0/17` and beyond for additional subnets if needed (private subnets, NAT gateway subnets, etc.).

With this layout, each service specifies all three subnets in its network configuration. ECS distributes tasks across them, and you have capacity headroom in each subnet to handle spikes and growth.

### What Happens When a Subnet Runs Out of IPs

Understanding the failure mode is crucial because it's not always immediately obvious. When a subnet exhausts its IP pool and ECS tries to launch a new task, the task enters a `PROVISIONING` state and remains there indefinitely. In the AWS Management Console, you'll see the task listed, but it won't transition to `PENDING` or `RUNNING`.

If you examine the task details in the ECS console or via the CLI, you'll find an event message similar to: "ResourceInitializationError: Unable to pull secrets or registry auth: netlink failure". That message is misleading—it's not actually a secrets or registry problem. The real issue is buried deeper: the ENI allocation failed because the subnet ran out of IPs.

The reason for the misleading error message is that when the ENI can't be allocated, the task's runtime environment never fully initializes, so later stages of task startup fail with generic errors.

From an application perspective, if this is a scaling event triggered by increased traffic, the load balancer notices that the service isn't launching new tasks. Request queues back up, latency increases, and users experience degraded performance. If you're not monitoring subnet IP availability, you might spend hours investigating application logs and looking for bugs in your code before realizing the infrastructure ran out of IPs.

This is why monitoring subnet IP availability is essential for large Fargate deployments. You can create a CloudWatch custom metric that tracks the number of available IPs in each subnet and set an alarm that triggers when available IPs drop below a threshold (perhaps 10% of the subnet's usable IP count). This gives you early warning before you hit the hard limit.

You can query available IPs using the AWS CLI:

```bash
aws ec2 describe-subnets --subnet-ids subnet-12345678 --query 'Subnets[0].AvailableIpAddressCount'
```

Incorporate this into a Lambda function that runs every few minutes, publishes the metric to CloudWatch, and you have visibility into your IP utilization.

### Cross-Subnet Load Balancing and Service Discovery

When you distribute Fargate tasks across multiple subnets, service discovery and load balancing need to work seamlessly across the subnet boundaries. Fortunately, the AWS networking layer handles this transparently.

If you're using an Application Load Balancer (ALB) or Network Load Balancer (NLB), the load balancer itself is deployed across the same subnets as your tasks. The load balancer's target group includes all tasks regardless of which subnet they're in, and traffic is routed directly to task ENIs across subnets. From the perspective of the load balancer, it doesn't matter whether tasks are in the same subnet or different subnets—it has routes to all of them.

Similarly, if you're using AWS Cloud Map for service discovery, tasks can discover and communicate with each other across subnets without issue. The DNS records returned by Cloud Map include the private IP addresses of all healthy tasks, and the VPC routing allows direct communication between those IPs.

One subtlety: if you're manually managing security groups for your Fargate tasks, ensure that the security groups allow inbound traffic on the ports your tasks listen on, regardless of which subnet the traffic originates from. A common mistake is to create a security group that only allows traffic from a specific IP address or subnet, then deploy tasks across multiple subnets. Tasks in other subnets then can't communicate with the restricted tasks.

### Monitoring and Auto-Scaling Considerations

Large Fargate deployments often rely on auto-scaling to handle variable workloads. ECS service auto-scaling uses CloudWatch metrics (like CPU and memory utilization) to adjust the desired task count dynamically. But auto-scaling doesn't account for available IP addresses in your subnets—it only knows about EC2 auto-scaling capacity and task placement failures.

If a subnet runs out of IPs, auto-scaling might still try to launch additional tasks, but those tasks will get stuck in `PROVISIONING` and never start. From an auto-scaling perspective, the desired count is 100 but the running count is 80, so the scaling logic keeps trying to launch more tasks, all of which fail silently.

To prevent this scenario, configure your ECS service's auto-scaling with an appropriate maximum task count. Calculate the maximum based on your total available IP addresses across all subnets, then set a conservative upper bound that leaves headroom.

Additionally, implement alarms that trigger not just on application metrics but on infrastructure metrics. Monitor the `AvailableIpAddressCount` for each subnet and set alarms that notify you when this number drops below a safe threshold. Combine this with alarms on ENI count at the region level, and you have comprehensive visibility into the constraints that can limit your scale.

### Handling Seasonal Peaks and Rare Events

Real applications often have predictable seasonal peaks: an e-commerce site might expect 10x traffic during holiday shopping season, a tax preparation service might have a predictable surge during tax season, or a media platform might see spikes when major events occur.

If your baseline Fargate deployment is sized for normal traffic but your peak could be 5x or 10x higher, you need to size your subnet IP pools for that peak, not your baseline. This sounds wasteful—why reserve IPs for capacity you only use occasionally?—but it's necessary for reliability.

The alternative is to dynamically expand your subnet capacity, but that's not feasible since subnets can't be resized. You could create additional subnets and add them to your service's configuration during peak periods, but that requires operational toil and carries risks of misconfiguration.

The better approach is to size your subnets for your peak requirements from the start. If your baseline is 50 tasks but your peak is 500 tasks, size your subnets for 500 plus overhead. The unused IP addresses during off-peak periods are simply the cost of maintaining reliability during peaks.

For truly massive peaks or rare events (say, 50x your baseline), consider whether Fargate is even the right tool. Fargate scales well for 10-20x growth, but beyond that, you might reach ENI quota limits at the region level. At that scale, multi-region deployments or hybrid approaches using both Fargate and EC2 might be necessary.

### Multi-Region Deployments and ENI Planning

If you're planning a multi-region Fargate deployment, the ENI quota limit becomes even more important to understand. Each region has its own 350 ENI quota (adjustable). If you're running identical services in two regions, you're consuming ENIs in both, but the quotas are independent.

For example, if you have a service running 200 tasks in `us-east-1`, it consumes 200 of your 350 ENIs in that region. The same service running 200 tasks in `eu-west-1` consumes 200 of your 350 ENIs in that region. There's no cross-region sharing of the quota.

This is actually an advantage: you can independently scale each region to the regional ENI limit. But it also means you need to plan quota increases for each region separately if you're running large workloads globally.

### Real-World Recommendations

Based on production experience with large Fargate deployments, here are some concrete recommendations:

First, always distribute tasks across at least three subnets in different availability zones. This is non-negotiable for any service targeting more than a handful of concurrent tasks. Even if your current needs could fit in a single subnet, building multi-subnet distribution into your architecture from the start prevents costly refactoring later.

Second, use `/23` CIDR blocks for subnets hosting Fargate tasks if you plan to run more than a few dozen tasks. A `/24` is technically sufficient for small deployments, but `/23` provides comfortable headroom without significantly wasting IP space. Avoid `/25` or smaller subnets for Fargate; the IP density becomes constrained quickly.

Third, implement monitoring of subnet IP availability and ENI regional quota consumption. These are not vanity metrics—they're critical infrastructure health indicators. When these numbers degrade, you want to know immediately, not when deployments start failing.

Fourth, maintain a 20-30% headroom buffer in your IP planning. Don't size subnets to exactly meet your projected peak; size them 20-30% larger. This provides margin for error in your projections, temporary bursts beyond expected peaks, and the inevitable miscellaneous resources that end up consuming IPs.

Fifth, document your CIDR block allocation plan. Create a simple spreadsheet or network diagram showing your VPC CIDR, all subnet CIDRs, their AZs, their allocation purposes, and their projected utilization. Update it as you add services or modify task counts. This becomes invaluable when you're troubleshooting capacity issues or planning future changes.

### Conclusion

Fargate abstracts away EC2 infrastructure beautifully, but it doesn't eliminate the underlying networking constraints—it just hides them until they bite you. Every task consumes an ENI and an IP address, and both are finite resources at different scopes: ENIs are limited per region, and IP addresses are limited per subnet.

At small scales, this rarely matters. But the moment you move toward production workloads with dozens of concurrent tasks or services that scale dynamically, these constraints become real architectural considerations. Proper CIDR planning, multi-subnet distribution, and thoughtful monitoring of infrastructure metrics separate reliable, scalable Fargate deployments from ones that fail mysteriously under load.

The good news is that these constraints are entirely predictable and manageable with upfront planning. Size your subnets conservatively, distribute across availability zones, monitor your infrastructure metrics, and you can scale Fargate services to handle hundreds or thousands of concurrent tasks without hitting hard limits.
