---
title: "Lambda VPC Networking Deep Dive: Hyperplane ENIs, NAT Gateways, and VPC Endpoints"
---

## Lambda VPC Networking Deep Dive: Hyperplane ENIs, NAT Gateways, and VPC Endpoints

When you first attach an AWS Lambda function to a virtual private cloud, you gain powerful security and network isolation benefits. You can now access resources within your VPC without exposing them to the internet, integrate with private RDS databases, and enforce network controls through security groups. But this convenience comes with a learning curve—and historically, it came with significant performance penalties.

Understanding how Lambda actually networks when attached to a VPC is essential for building scalable, cost-effective applications. The networking layer affects cold start times, IP address consumption, internet connectivity, and overall application reliability. In this article, we'll explore how Lambda's VPC networking evolved, how modern Hyperplane ENIs work, how to design your routing and endpoints for both performance and cost efficiency, and how to avoid common pitfalls that catch many developers off guard.

### The Historical Problem: Why VPC Attachment Used to Hurt Performance

Before 2019, attaching a Lambda function to a VPC came with a steep price: cold starts that could stretch into the tens of seconds. This wasn't because Lambda itself became slower; it was because of how the networking layer worked.

When you configured a Lambda function with VPC settings, AWS had to attach an elastic network interface (ENI) to your function for each concurrent execution. Creating an ENI is not a lightweight operation—it involves allocating an IP address from your subnet, configuring the network layer, and attaching it to the Lambda execution environment. All of this happened *during* the cold start, before your function code even began executing.

If your function experienced a burst of concurrent invocations, Lambda needed to provision multiple ENIs sequentially. With each one taking several seconds to attach, you could easily end up with cold start times of 10, 20, or even 30 seconds for highly concurrent workloads. For a function that normally executes in 500 milliseconds, a 15-second cold start feels like a catastrophic performance regression.

This created a painful choice: either accept terrible cold start performance and long tail latencies in your VPC-attached functions, or architect your application to avoid VPC attachment altogether. Many developers worked around this limitation by using resources like Lambda functions to access VPC resources through proxies, or by avoiding VPC attachment entirely and accepting lower security posture.

### Enter Hyperplane ENIs: Solving the Cold Start Problem

In late 2019 and early 2020, AWS introduced Hyperplane ENIs—a fundamental redesign of how Lambda interfaces with VPC networking. This change was transparent to developers; you didn't need to update your code or change your configuration. But under the hood, everything changed.

Instead of creating a new ENI for each function execution, Hyperplane ENIs use a shared, pre-provisioned network interface that sits at the hypervisor level. Think of it as a bridge between the Lambda execution environment and your VPC. Multiple concurrent executions route through this shared interface without needing their own individual ENIs. AWS pre-provisions these Hyperplane ENIs in advance based on your account's expected Lambda usage patterns, so they're ready before your function even cold starts.

The impact was dramatic: VPC-attached functions went from adding 10-15 seconds to cold starts to adding only 500 milliseconds to a second. Suddenly, VPC attachment became viable for performance-sensitive workloads.

This architectural shift also solved a secondary but equally important problem: IP address exhaustion. Previously, high-concurrency functions would burn through IP addresses in your subnet at an alarming rate, because each concurrent execution needed its own ENI with its own IP address. With Hyperplane ENIs sharing a single interface, the relationship between concurrency and IP consumption became much more favorable.

### Understanding IP Address Consumption in Modern Lambda

Even though Hyperplane ENIs are shared, you still need to plan for IP address consumption. Lambda reserves IP addresses from your VPC subnet for each account within that region and VPC, regardless of how many functions you're actually running. Understanding this consumption model is critical for subnet planning.

When you attach your first Lambda function to a VPC in a given region, AWS reserves a block of IP addresses in your subnet. The size of this block depends on your account's expected throughput and concurrency. For most accounts, AWS reserves approximately 64 IP addresses per VPC-enabled subnet (though this can vary). Additional ENIs may be provisioned if you sustain high concurrency over time, but the initial reservation is what you'll hit first.

To plan appropriately, ensure your subnet has sufficient IP space. A /24 subnet gives you 256 usable addresses; a /25 gives you 128. If you're running high-concurrency Lambda workloads alongside EC2 instances, RDS databases, or ECS tasks in the same subnet, you could face address exhaustion. A common pattern is to dedicate a specific subnet (or set of subnets) to Lambda, sized appropriately for your expected concurrency.

You can check your current ENI usage in the EC2 console or via the AWS CLI. Lambda-provisioned ENIs typically appear with descriptive names, making them easy to identify:

```bash
aws ec2 describe-network-interfaces \
  --filters "Name=description,Values=*Lambda*" \
  --region us-east-1
```

This command shows you the Hyperplane ENIs your account is currently using, along with their associated IP addresses. Monitoring this over time helps you understand your actual consumption patterns and validate that your subnet sizing is appropriate.

### The Cost of VPC Attachment: Losing Free Internet Access

The moment you attach a Lambda function to a VPC, you lose something critical: free internet access. This is one of the most commonly overlooked gotchas.

When a Lambda function runs *without* VPC attachment, it automatically has internet access through AWS-managed routing. You can reach any public endpoint on the internet without additional configuration. This is convenient for functions that need to call third-party APIs, download packages, or reach services like Amazon S3.

Attach that same function to a VPC, and internet access disappears. Your function can reach other resources within the VPC (assuming security groups allow it), but outbound traffic to the internet will silently fail. This happens because the function now routes all traffic through your VPC's network stack, and your VPC is isolated from the internet by default.

To restore internet access, you need to explicitly route outbound traffic through a NAT gateway or NAT instance. This introduces both architectural considerations and cost implications.

### Routing Internet Traffic Through NAT Gateways

A NAT gateway sits in a public subnet and translates outbound traffic from your Lambda functions (which run in private subnets) to the internet. When your function makes a request to an external service, the request gets routed to the NAT gateway, which replaces the source IP address with its own Elastic IP, forwards the request, and then translates the response back.

Setting this up requires a few layers of configuration. Your Lambda functions typically run in a private subnet—one with no direct route to the internet gateway. You configure a route in that subnet's route table that directs internet-bound traffic (0.0.0.0/0) to a NAT gateway sitting in a public subnet. The NAT gateway, in turn, has a route through the internet gateway, which connects to the internet.

Here's a conceptual flow: your Lambda function initiates a connection to api.external-service.com → the private subnet's route table directs it to the NAT gateway → the NAT gateway's public subnet routes it to the internet gateway → the traffic reaches the internet.

This architecture works reliably, but it comes with a cost: NAT gateways charge both for the hour they're provisioned and for each gigabyte of data processed. For a Lambda-heavy workload making frequent external API calls, NAT gateway costs can become significant. A NAT gateway processing a few terabytes of data per month might add thousands of dollars to your AWS bill.

Before designing a solution around NAT gateways, consider whether you actually need them. Not all VPC-attached Lambda functions require internet access. If your function only needs to access resources within your VPC—a private RDS database, for example—you don't need a NAT gateway at all, and your networking becomes simpler and cheaper.

### VPC Endpoints: Private Access Without NAT Costs

For functions that do need to reach AWS services, VPC endpoints offer a powerful alternative to NAT gateways. An endpoint lets your function communicate with an AWS service without routing traffic across the internet. The traffic stays within the AWS network, avoiding both NAT gateway costs and the latency that sometimes accompanies internet routing.

AWS offers two types of VPC endpoints, each suited to different use cases.

**Gateway endpoints** provide private access to Amazon S3 and DynamoDB. When you create a gateway endpoint, AWS automatically adds routes to your subnet's route table that redirect traffic destined for that service to the endpoint instead of the internet. From your Lambda function's perspective, the service appears to be in your VPC. You call S3 or DynamoDB exactly as you normally would—there's no configuration needed in your application code.

Gateway endpoints are free to provision and use, making them an obvious choice whenever you're accessing S3 or DynamoDB from a VPC-attached function. If your function reads objects from S3 or queries a DynamoDB table, creating a gateway endpoint for that service should be a reflex decision.

**Interface endpoints** (also called PrivateLink endpoints) work with nearly every AWS service—SNS, SQS, Lambda, Secrets Manager, Systems Manager Parameter Store, and many others. Unlike gateway endpoints, interface endpoints appear as ENIs in your VPC, and traffic to them flows through the VPC's network layer. You access them either through a private DNS name (which resolves to the interface endpoint's ENI) or by explicitly specifying the endpoint URL in your SDK calls.

Interface endpoints do charge a small hourly fee, typically around $7 per month per endpoint. For a Lambda function that calls SQS thousands of times per day, an interface endpoint might still be cost-justified compared to NAT gateway charges. But for occasional calls to a service, the NAT gateway or even VPC-less execution might be more economical.

When using an interface endpoint, you have two integration patterns. The simpler approach is to enable private DNS resolution on the endpoint, which causes the service's DNS name to resolve to the endpoint's private IP address. Your code calls the service exactly as it normally would, and AWS handles the routing. Alternatively, you can explicitly construct endpoints in your SDK, specifying the endpoint URL. This approach gives you explicit control but requires code changes.

Here's a quick example of explicitly specifying an SQS interface endpoint in Python:

```python
import boto3

# Create SQS client pointing to interface endpoint
sqs = boto3.client(
    'sqs',
    region_name='us-east-1',
    endpoint_url='https://vpce-12345678-abcdefgh.sqs.us-east-1.vpce.amazonaws.com'
)

# Use the client normally
response = sqs.send_message(
    QueueUrl='https://queue.amazonaws.com/123456789012/MyQueue',
    MessageBody='Hello from Lambda'
)
```

When deciding between NAT gateways and interface endpoints, consider your traffic patterns and cost profile. A function that makes occasional calls to external APIs probably needs a NAT gateway. A function that frequently accesses DynamoDB and SQS should definitely use gateway and interface endpoints. A function that does both might benefit from a combination: interface endpoints for AWS services and a NAT gateway for external APIs, with careful routing to minimize NAT traffic.

### Designing Security Groups for VPC-Attached Lambda

Once your Lambda function is in a VPC, security group configuration becomes critical. A security group acts as a stateful firewall, controlling which inbound and outbound connections are allowed.

The default security group in most VPCs allows all outbound traffic and restricts all inbound traffic. For Lambda, this is usually the right starting point. Your function will rarely need to accept inbound connections (that's more appropriate for web servers). But you do need outbound connectivity to reach resources within your VPC or the internet.

When your function needs to connect to another resource—a database, a cache cluster, an EC2 instance—you need to ensure two things: the security group attached to your function allows *outbound* traffic to the target, and the security group on the target resource allows *inbound* traffic from your function.

This is where many developers make mistakes. They attach the same security group to both the Lambda function and the target RDS database, relying on the assumption that the security group allows self-referential traffic. This works, but it's a bit of a coincidence—it only works because the security group rule happens to apply to itself. A more explicit and maintainable approach is to configure specific rules:

On the Lambda function's security group: allow outbound traffic on port 3306 (for MySQL) to the database's security group.

On the RDS database's security group: allow inbound traffic on port 3306 from the Lambda function's security group.

This explicit configuration makes it immediately clear what's allowed and why, which is invaluable when troubleshooting connectivity issues six months from now.

One more consideration: if your Lambda function needs to reach an interface endpoint, the endpoint's security group must allow inbound traffic on the appropriate port from your function's security group. Interface endpoints are attached to ENIs just like any other resource, so standard security group rules apply.

### Bringing It All Together: A Practical Architecture

Let's walk through a realistic scenario: a Lambda function that needs to process messages from SQS, query a private RDS database, occasionally call an external API, and write logs to CloudWatch.

Your networking setup might look like this:

Start with a VPC containing at least two subnets designated for Lambda. These are private subnets without direct routes to the internet gateway. In these subnets, you'll attach your Lambda functions.

Create interface endpoints for SQS and Secrets Manager within your VPC (if you're using Secrets Manager to store database credentials). Enable private DNS resolution on these endpoints so your code calls them using their standard DNS names.

Place your RDS database in the same VPC, in a separate database subnet group. Configure its security group to accept inbound traffic on port 3306 from the Lambda security group.

For internet access, deploy a NAT gateway in a public subnet. Add a 0.0.0.0/0 route in your Lambda subnets' route tables pointing to this NAT gateway.

Attach the Lambda function to the VPC, specifying your private subnets and a security group that allows outbound traffic to the RDS security group, the SQS interface endpoint, and the NAT gateway (via the route table, not directly).

This architecture provides:
- Private, secure access to RDS without exposing it to the internet
- Cheap access to SQS and Secrets Manager via interface endpoints, without NAT gateway overhead for these frequently-called services
- Internet access for external API calls via the NAT gateway
- Clear, auditable security group rules that document what's allowed and why

Your bill reflects this design: small interface endpoint charges for SQS and Secrets Manager, NAT gateway charges only for your external API traffic, and no costs for accessing AWS services through gateway or interface endpoints.

### Common Pitfalls and Troubleshooting

Even with a solid understanding of VPC networking, several stumbling blocks catch developers regularly.

**The DNS resolution trap:** You create an interface endpoint but forget to enable private DNS resolution, or you enable it but your function's VPC doesn't have DNS resolution enabled at the VPC level. The endpoint is there, but your function's DNS queries still try to reach the public AWS endpoint, which fails from within your VPC. Always verify that DNS resolution is enabled on both the endpoint and the VPC itself.

**Overly permissive security groups:** It's tempting to create a single security group and attach it to everything, or to allow 0.0.0.0/0 (any source) for convenience. This works, but it defeats much of the security benefit of VPC attachment. Take time to design explicit rules, even if it feels like extra work upfront.

**Forgetting about NAT gateway costs:** Developers attach functions to VPCs, forget about NAT gateways, and suddenly discover $500 of unexpected charges at the end of the month. Before you implement NAT-dependent architecture, verify that a NAT gateway makes sense for your use case. If you're just occasionally calling external APIs, the cost might not be justified.

**Subnet sizing mistakes:** A /28 subnet sounds fine until your Lambda workload scales and you realize you only have 8 usable IP addresses. Plan for growth, and remember that Lambda reserves IP addresses even for functions that aren't currently running.

**The Lambda Hyperplane ENI is not visible:** If you're looking for your Lambda function's ENI in the EC2 console and can't find it, don't assume something's wrong. Hyperplane ENIs are managed by AWS and may not be visible through normal EC2 tools. Use the filter mentioned earlier to see them, and trust that they're there.

### Conclusion

Lambda's integration with VPC networking has evolved significantly since the early days of slow, unpredictable cold starts. Hyperplane ENIs made VPC attachment practical for performance-sensitive workloads. Understanding how to design your networking layer—choosing the right combination of NAT gateways, gateway endpoints, and interface endpoints—is critical for building applications that are both secure and cost-effective.

The key takeaway is this: VPC attachment is no longer something to avoid or reluctantly accept. But it requires thoughtful design. Know your traffic patterns, size your subnets appropriately, use gateway and interface endpoints to minimize NAT costs, and keep your security groups explicit and auditable. When you get these decisions right, VPC-attached Lambda functions provide powerful security isolation without the performance or reliability compromises of the past.
