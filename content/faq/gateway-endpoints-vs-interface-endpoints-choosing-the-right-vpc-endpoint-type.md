---
title: "Gateway Endpoints vs Interface Endpoints: Choosing the Right VPC Endpoint Type"
---

## Gateway Endpoints vs Interface Endpoints: Choosing the Right VPC Endpoint Type

When you're building applications on AWS, you often face a fundamental architectural question: how do your resources inside a VPC securely access AWS services without traversing the public internet? The answer lies in VPC endpoints, but understanding which type to use—Gateway Endpoints or Interface Endpoints—requires more than just knowing they both exist. This decision affects your security posture, costs, and operational complexity, making it one of the more nuanced choices in VPC design.

In this article, we'll explore both endpoint types in depth, understand their technical differences, examine their limitations, and work through practical patterns for choosing between them. By the end, you'll have a clear mental model for making this decision confidently in your own architectures.

### Understanding VPC Endpoints: The Why and the How

Before we dive into the differences, let's establish what problem VPC endpoints solve. Imagine you have an EC2 instance in a private subnet that needs to upload files to S3. Without VPC endpoints, your instance would need to route traffic through a NAT gateway to reach S3 across the public internet. This approach works, but it introduces latency, costs for data transfer, and potential security surface area.

VPC endpoints let your instances reach AWS services using private IP addresses and the AWS internal network. No internet gateway, no NAT gateway, no public internet involvement. The traffic never leaves the AWS backbone. This is both more secure and, depending on your data volumes, often more cost-effective.

AWS offers two distinct flavors of VPC endpoints, and they're fundamentally different in how they work.

### Gateway Endpoints: Simple, Free, and Limited

Gateway Endpoints are the simpler of the two options. They're also completely free—no hourly charges, no data transfer costs. But that simplicity comes with a significant constraint: they only support two AWS services.

Gateway Endpoints are available exclusively for Amazon S3 and Amazon DynamoDB. If your use case involves either of these services, Gateway Endpoints should be your first consideration simply because of their cost structure and integration model.

#### How Gateway Endpoints Work

A Gateway Endpoint doesn't create any new networking infrastructure in your VPC. Instead, it works by modifying your VPC's route tables. When you create a Gateway Endpoint for S3, you specify which route tables should use it. AWS then adds a route entry—typically a prefix list route—that directs traffic destined for S3 to the Gateway Endpoint.

Here's what that looks like in practice. Suppose you create a Gateway Endpoint for S3 in your VPC. AWS automatically generates a prefix list, something like `pl-12345678`, that represents all S3 IP address ranges in your region. In your route table, you'll see a new route:

```
Destination: pl-12345678 (S3)
Target: vpce-12345678 (Gateway Endpoint)
```

When your EC2 instance makes a request to S3, the routing decision is made at the network layer. The instance doesn't need any special configuration; it simply uses the standard AWS SDK to call S3, and the route table ensures the traffic flows through the Gateway Endpoint instead of heading toward the internet gateway.

This is elegant because it requires no changes to your application code. Your instances connect to S3 exactly as they would normally—using the public S3 endpoint name like `s3.amazonaws.com`—but the traffic itself stays within AWS's private network.

#### Service Limitations and Why They Exist

The restriction to S3 and DynamoDB isn't arbitrary. Gateway Endpoints use a different underlying technology than Interface Endpoints, and this technology doesn't scale well to the hundreds of AWS services available today. AWS designed Gateway Endpoints specifically for the services that generate the highest data transfer volumes and where the cost savings are most significant.

If you need VPC endpoint access to other services—perhaps RDS, Secrets Manager, SNS, SQS, or any of the dozens of other AWS services—you'll need Interface Endpoints instead.

#### Endpoint Policies for Access Control

Even though Gateway Endpoints are simple, they support endpoint policies, which allow you to implement fine-grained access control at the VPC endpoint level. An endpoint policy is a JSON policy document that specifies which principals can perform which actions through the endpoint.

Here's a practical example. You might want to allow all your EC2 instances to read from S3, but only specific instances in specific subnets to write to S3. You can express this with a Gateway Endpoint policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Principal": "*",
      "Action": "s3:GetObject",
      "Effect": "Allow",
      "Resource": "arn:aws:s3:::my-bucket/*"
    },
    {
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT-ID:role/PowerUserRole"
      },
      "Action": "s3:*",
      "Effect": "Allow",
      "Resource": "*"
    }
  ]
}
```

This policy allows any principal to read objects from your bucket, but only the PowerUserRole can perform any S3 action. When a request comes through the Gateway Endpoint that doesn't match your policy, it's denied. This gives you another layer of defense beyond security groups and IAM roles.

It's worth noting that endpoint policies operate in conjunction with, not instead of, IAM policies. If an IAM role lacks S3 permissions, the endpoint policy won't grant them. Both layers must permit the action.

### Interface Endpoints: Flexible, Feature-Rich, and Costly

Interface Endpoints represent AWS's more ambitious approach to VPC endpoints. They're powered by AWS PrivateLink technology and provide access to virtually every AWS service. This flexibility comes at a price—literally.

Interface Endpoints incur two types of charges: an hourly charge per endpoint (typically around $0.01 per hour, which is about $7.20 per month), and a per-GB data processing charge (typically $0.01 per GB). For workloads with modest data volumes, these costs are negligible, but they accumulate quickly in high-throughput scenarios.

#### How Interface Endpoints Work

Interface Endpoints are implemented as Elastic Network Interfaces (ENIs) in your VPC. When you create an Interface Endpoint, AWS provisions one or more ENIs—typically in different availability zones for redundancy—and assigns them private IP addresses from your VPC's CIDR block.

Because Interface Endpoints are ENIs, they're security group members, just like EC2 instances. This means you can apply security group rules to control which traffic is allowed to reach the endpoint. They also appear in your VPC's DNS, which allows for powerful DNS-based routing.

Let's walk through creating an Interface Endpoint for a service like Secrets Manager. You specify the VPC and subnets where you want the endpoint ENIs to be created. AWS then provisions ENIs in those subnets, assigns them private IP addresses, and registers them with the AWS service.

The key difference from Gateway Endpoints is that your traffic now flows to a specific network interface with a specific private IP address, not through a routing rule. This enables finer-grained control and visibility into which traffic flows to which endpoints.

#### DNS Resolution and Endpoint Services

When you create an Interface Endpoint, AWS creates DNS names that resolve to the endpoint's private IP addresses. This is where Interface Endpoints become genuinely powerful.

By default, AWS creates a regional endpoint DNS name (something like `secretsmanager.us-east-1.vpce.amazonaws.com`) and optionally enables private DNS names. If you enable private DNS name resolution, the standard service endpoint (like `secretsmanager.us-east-1.amazonaws.com`) automatically resolves to your Interface Endpoint's private IP address instead of the public service endpoint.

This is transformative for application compatibility. Your code can use the standard AWS SDK calls without any modification, and DNS resolution transparently directs the traffic to your private endpoint instead of the public internet. The application doesn't know or care—it just works.

This behavior is more nuanced than it might first appear. When private DNS names are enabled, applications within your VPC automatically use the Interface Endpoint. But applications outside your VPC—or your on-premises data center connected via Direct Connect—still resolve to the public endpoint. This means you can have a hybrid scenario where different parts of your infrastructure reach services through different paths, all managed transparently through DNS.

#### Security Groups and Network-Level Access Control

Because Interface Endpoints are ENIs, security groups apply to them. This provides network-level access control that's more granular than what Gateway Endpoints offer.

Consider a scenario where you have multiple applications in your VPC accessing a DynamoDB-compatible service through an Interface Endpoint. You might want only specific applications (identified by their security groups) to reach the endpoint. You can create a security group on the Interface Endpoint that allows inbound traffic only from those application security groups.

For example, your endpoint security group might have a rule like:

```
Inbound: Allow TCP port 443 from sg-application-servers
```

This ensures that only EC2 instances (or other ENIs) in the application-servers security group can reach the endpoint. Any other traffic is dropped at the network layer before it even reaches the endpoint itself.

This is particularly valuable in multi-tenant or highly segmented environments where different teams or applications need different levels of access. The security group becomes an additional enforcement point for your access policies.

#### Endpoint Policies and Fine-Grained Access

Like Gateway Endpoints, Interface Endpoints support endpoint policies. These policies work identically to Gateway Endpoint policies—they specify which principals can perform which actions through the endpoint, and they work in conjunction with IAM roles and policies.

Endpoint policies on Interface Endpoints are particularly useful for implementing least-privilege access at the endpoint level. You might have an application that needs to write to a specific SNS topic but read from multiple SQS queues. Your endpoint policy can enforce that granular permission structure:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT-ID:role/ApplicationRole"
      },
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Effect": "Allow",
      "Resource": "arn:aws:sqs:us-east-1:ACCOUNT-ID:allowed-queue"
    },
    {
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT-ID:role/ApplicationRole"
      },
      "Action": "sns:Publish",
      "Effect": "Allow",
      "Resource": "arn:aws:sns:us-east-1:ACCOUNT-ID:allowed-topic"
    }
  ]
}
```

### Direct Comparison: Gateway vs Interface Endpoints

Now that we've explored each type individually, let's compare them across several important dimensions.

#### Service Coverage

This is the most fundamental difference. Gateway Endpoints support only S3 and DynamoDB. Interface Endpoints support virtually every AWS service—EC2, RDS, Lambda, Secrets Manager, Systems Manager Parameter Store, SNS, SQS, CloudWatch, API Gateway, and many others.

If your application needs to access any service beyond S3 or DynamoDB, you must use Interface Endpoints. This constraint alone eliminates Gateway Endpoints for most complex workloads.

#### Cost Structure

Gateway Endpoints are free. No hourly charges, no data transfer charges. This makes them incredibly attractive for S3 and DynamoDB workloads, especially those involving large data transfers.

Interface Endpoints charge by the hour (approximately $0.01 per hour per endpoint) and per GB of data processed (approximately $0.01 per GB). In a region with multiple availability zones and redundant endpoints, or in workloads with high data volumes, these costs become significant. A production-grade Interface Endpoint in two availability zones might cost $15-20 per month just in hourly charges, before any data transfer costs.

For a workload processing 1 TB of data monthly through an Interface Endpoint, the data transfer charge alone would be $10, plus the hourly charges. In contrast, the same workload through a Gateway Endpoint to S3 would cost nothing at the endpoint layer.

#### Implementation Complexity

Gateway Endpoints are simpler. You create the endpoint, select your route tables, and you're done. The routing is automatic and transparent.

Interface Endpoints are more complex. You must choose which subnets receive the endpoint ENIs, configure security groups, potentially configure DNS settings, and manage the endpoint's lifecycle. This additional complexity is the price you pay for flexibility.

#### Access Control Mechanisms

Gateway Endpoints support endpoint policies but lack the network-level security group controls of Interface Endpoints.

Interface Endpoints offer both endpoint policies and security groups, providing two independent layers of access control. This added flexibility is valuable in complex security architectures.

#### Performance Characteristics

Both endpoint types offer excellent performance within AWS's private network. However, the implementation differences create subtle variations. Gateway Endpoints use route-table-based routing, which is extremely efficient. Interface Endpoints route through an ENI, which adds a negligible but measurable amount of latency.

For most workloads, this latency difference is imperceptible. But in latency-sensitive scenarios—particularly for DynamoDB operations where microseconds matter—Gateway Endpoints have a theoretical advantage.

### Practical Decision Framework

Given the tradeoffs between these endpoint types, how should you choose in practice?

**If you're accessing S3 or DynamoDB exclusively**, use a Gateway Endpoint. The cost savings are significant, the implementation is simple, and there's no reason to pay Interface Endpoint charges when Gateway Endpoints exist. This is the straightforward case.

**If you're accessing S3 or DynamoDB along with other AWS services**, you'll likely use a Gateway Endpoint for S3 or DynamoDB and Interface Endpoints for the other services. This hybrid approach is common in real-world architectures. Your database application might use a Gateway Endpoint to S3 for backups and an Interface Endpoint to Secrets Manager for credential retrieval.

**If you're accessing multiple AWS services without S3 or DynamoDB**, use Interface Endpoints exclusively. There's no Gateway Endpoint option, so the choice is made for you.

**If you have highly sensitive security requirements** around specific applications' access to services, Interface Endpoints' security group controls provide an additional enforcement layer worth the cost. This is particularly relevant in regulated industries or multi-tenant environments.

**If you're optimizing for cost in a high-throughput scenario**, carefully calculate the Interface Endpoint charges. An application processing 100 GB daily through an Interface Endpoint incurs about $30 monthly in data transfer charges alone. In that case, you might consider alternative architectures—perhaps batching operations or using different service access patterns—to reduce endpoint usage.

### Cost Optimization Patterns

Several patterns can help you optimize endpoint costs while maintaining security and convenience.

**Shared endpoints across applications**: Rather than creating separate Interface Endpoints for each application or team, consolidate endpoints. One Secrets Manager endpoint can serve multiple applications if you use endpoint policies to control which applications can access which secrets. This approach reduces hourly charges while maintaining security.

**Selective endpoint deployment**: You don't need every application to use Interface Endpoints for every service. A Lambda function that occasionally calls Secrets Manager might connect through the public internet (with NAT gateway costs) while EC2 instances with high-volume Secrets Manager access use Interface Endpoints. Profile your workload to identify where endpoints deliver the most value.

**Gateway Endpoints as your default for S3 and DynamoDB**: Unless you have unusual requirements, default to Gateway Endpoints for these services. The cost difference is too significant to ignore, and the operational simplicity is a bonus.

**DNS-based routing for cost control**: With Interface Endpoints' DNS capabilities, you can route some traffic through endpoints and other traffic through public endpoints or NAT gateways based on DNS resolution. This is a more advanced pattern but allows fine-tuned cost optimization.

### Real-World Scenarios

Let's examine how these endpoints appear in actual architectures.

**E-commerce application with image processing**: An e-commerce platform stores product images in S3 and uses DynamoDB for inventory tracking. Catalog services running on EC2 need to read and write data to both services at high volume. This workload uses Gateway Endpoints for both S3 and DynamoDB—free, simple, and perfectly adequate. The application retrieves secrets from Secrets Manager (for API keys to external services), which requires an Interface Endpoint.

**Data analytics platform**: A data pipeline reads data from multiple AWS services—S3 for raw data storage, DynamoDB for job configuration, Lambda for serverless processing, CloudWatch for metrics, and SNS for notifications. This complex workload uses a Gateway Endpoint for S3, but Interface Endpoints for DynamoDB (if the volume justifies it beyond simple configuration), Lambda, CloudWatch, and SNS. The Gateway Endpoint saves costs on massive S3 data transfers, while Interface Endpoints provide the necessary access to other services.

**Microservices platform**: A microservices architecture with dozens of services communicating through SQS and SNS, accessing RDS databases, retrieving secrets from Secrets Manager, and storing backups in S3. This uses a Gateway Endpoint for S3 backups, but Interface Endpoints for SQS, SNS, RDS Proxy, and Secrets Manager. The architecture likely uses shared endpoints across services to reduce hourly charges.

### Migration Considerations

If you have an existing VPC without endpoints, migrating to use them requires careful planning.

For S3 and DynamoDB, adding a Gateway Endpoint is low-risk. You create the endpoint, select your route tables, and traffic automatically flows through it. Applications see no disruption because the DNS names they use don't change—only the routing changes.

For Interface Endpoints, the migration is more nuanced because DNS names matter. If you enable private DNS names on an Interface Endpoint for a service like Secrets Manager, and your applications are already hard-coded to use the public endpoint name, you might experience unexpected behavior changes. Testing in a development environment first is essential.

The safest migration pattern is to create Interface Endpoints with private DNS names disabled initially, update your applications to use the endpoint-specific DNS names, and only then enable private DNS names. This controlled approach minimizes surprise behavior changes.

### Monitoring and Troubleshooting

Once you've deployed endpoints, monitoring their behavior is important.

For Gateway Endpoints, CloudTrail logs show S3 and DynamoDB operations that flow through the endpoint. VPC Flow Logs show the routing decisions. If an application suddenly loses access to S3, check whether the route table still has the Gateway Endpoint route and whether the endpoint policy hasn't been accidentally modified.

For Interface Endpoints, security group rules are an additional troubleshooting point. Applications unable to reach an Interface Endpoint often have a security group issue—either the endpoint's security group doesn't allow the inbound traffic, or the application's security group doesn't allow the outbound traffic to the endpoint's private IP address. VPC Flow Logs will show the traffic being rejected, pointing you toward the security group misconfiguration.

CloudWatch metrics for Interface Endpoints show endpoint connection counts and data throughput, helping you understand usage patterns and validate that traffic is actually flowing through the endpoint rather than some alternative path.

### Conclusion

VPC endpoints represent a powerful way to improve the security and cost-efficiency of your AWS architectures. Gateway Endpoints and Interface Endpoints serve different purposes, and choosing between them is less about one being better than the other and more about matching the right tool to your specific requirements.

Gateway Endpoints are your straightforward choice for S3 and DynamoDB—use them unless you have a compelling reason not to. They're free, simple, and effective. Interface Endpoints unlock access to the broader AWS service ecosystem and provide more sophisticated access control mechanisms, but at a measurable cost.

In most real-world architectures, you'll use both types in a complementary way. Gateway Endpoints handle your S3 and DynamoDB traffic cost-effectively, while Interface Endpoints provide secure access to the services that require them. Understanding the tradeoffs between these two approaches allows you to build architectures that are simultaneously secure, cost-efficient, and operationally straightforward.
