---
title: "Soft Limits vs Hard Limits in AWS: Understanding Service Quotas"
---

## Soft Limits vs Hard Limits in AWS: Understanding Service Quotas

When you start building applications on AWS, you'll quickly discover that nearly everything has a limit. You can't launch an infinite number of EC2 instances, run an unlimited number of Lambda functions concurrently, or store boundless data in a single DynamoDB table. These constraints exist for good reasons—they protect the infrastructure, prevent runaway costs, and ensure fair resource allocation across AWS's global customer base.

But not all limits are created equal. Some are deliberately loose constraints designed to accommodate growth, while others are fundamental boundaries that can't be moved no matter how much you need them to budge. Understanding the difference between soft limits and hard limits—and knowing how to identify which is which—is crucial for designing scalable, resilient applications and avoiding architectural dead ends.

### What Are Soft and Hard Limits?

**Soft limits** are service quotas that AWS allows you to increase through a formal request process. Think of them as guardrails designed to protect you from unexpected charges and resource exhaustion, but they're not immovable barriers. If your application legitimately needs more capacity, you can work with AWS to raise the limit.

**Hard limits**, by contrast, are absolute technical boundaries that cannot be increased under any circumstances. They represent fundamental constraints of the service's architecture, physics, or regulatory requirements. Asking AWS to raise a hard limit is like asking gravity to stop working—it's simply not possible.

The practical implication is straightforward: when you hit a soft limit, you have a path forward. When you hit a hard limit, you need to architect your solution differently.

### Real-World Examples: Lambda Concurrent Executions vs. /tmp Storage

To make this concrete, let's look at AWS Lambda, a service rich with both types of limits.

**Lambda concurrent execution limit** (soft limit): By default, AWS allows you to run 1,000 concurrent executions per region in your account. This number can feel constraining when you're scaling up, but it's adjustable. You can request an increase through the AWS Service Quotas console, and AWS will typically grant the increase after reviewing your use case. The limit exists to prevent billing surprises and protect the platform, but there's no technical reason AWS can't raise it for you if you demonstrate a legitimate need.

**Lambda /tmp storage size** (historically a hard limit): For years, every Lambda function had access to exactly 512 MB of ephemeral storage in the `/tmp` directory, and this limit was absolute. You couldn't request an increase, no matter your circumstances. If your application needed to write temporary files larger than 512 MB, you simply couldn't do it within Lambda—you'd need to stream data to S3, use a different service, or refactor your approach entirely. The limit was technical: Lambda's execution environment was designed with that constraint baked in.

Interestingly, AWS recently made `/tmp` storage adjustable (up to 10 GB), shifting it from a hard limit to a soft limit. This reflects AWS's evolving infrastructure and customer feedback. It's a good reminder that limits aren't always static—they evolve as technology and architecture improve.

### How to Distinguish Soft from Hard Limits in the AWS Console

The AWS Service Quotas console is your primary tool for understanding and managing limits. Here's how to navigate it effectively.

Access the Service Quotas console from the AWS Management Console, then select the service you're interested in. You'll see a list of quotas for that service. Each quota entry includes a **Quota Value** column, which tells you the current limit, and a **Quota Dimension** that explains what's being limited.

The key indicator is whether you can request an increase. If the quota has a "Request quota increase" button available, it's a soft limit. If no such button exists, it's a hard limit (or a limit that AWS doesn't currently allow adjustments on through this interface).

For example, in the Lambda service quotas, you'll see:
- **Concurrent Executions**: Adjustable, soft limit. You can click "Request quota increase."
- **Ephemeral storage (/tmp)**: Adjustable, soft limit (as of recent updates). You can request an increase.
- **Maximum payload size for direct invocation**: Hard limit. No request button appears because AWS doesn't adjust this.

The console also shows you your current usage against each quota, which is invaluable for capacity planning. If you're consistently at 80% of a soft limit, it's prudent to request an increase proactively rather than waiting to hit the wall during a traffic spike.

### Querying Quotas Programmatically

While the console is useful for manual exploration, production systems often need to query quotas programmatically. AWS provides the Service Quotas API for exactly this purpose, with two primary operations: `GetServiceQuota` and `ListServiceQuotas`.

**GetServiceQuota** retrieves a specific quota for a service:

```bash
aws service-quotas get-service-quota \
  --service-code lambda \
  --quota-code L-B3293D42
```

This returns a JSON response including the quota name, description, current value, and a boolean flag indicating whether it's adjustable:

```json
{
  "Quota": {
    "ServiceCode": "lambda",
    "ServiceName": "AWS Lambda",
    "QuotaArn": "arn:aws:service-quotas:us-east-1:123456789012:lambda/L-B3293D42",
    "QuotaName": "Concurrent Executions",
    "Description": "The maximum number of concurrent Lambda function executions.",
    "Value": 1000,
    "Unit": "Count",
    "Adjustable": true,
    "GlobalQuota": false
  }
}
```

The `Adjustable` field is your flag: `true` means soft limit, `false` means hard limit.

**ListServiceQuotas** returns all quotas for a given service:

```bash
aws service-quotas list-service-quotas \
  --service-code dynamodb
```

This is particularly useful when you're building a quota-aware application that needs to validate configuration or warn users when they're approaching limits.

You can also request a quota increase programmatically using **RequestServiceQuotaIncrease**:

```bash
aws service-quotas request-service-quota-increase \
  --service-code ec2 \
  --quota-code L-1216C47A \
  --desired-value 100
```

This creates a case in AWS, and you'll be notified when the request is approved or denied. Most adjustable quotas are approved within hours or days, though the timeline depends on the specific limit and your request size.

### Architectural Implications of Hard Limits

Hard limits force architectural decisions. Understanding them early prevents building systems that can't scale the way you need them to.

Consider DynamoDB, which has a hard limit of 40 KB per item (the maximum size of a single record). There's no way around this—you can't ask AWS to let you store a 100 KB record in a single DynamoDB item. If your application needs to store large documents, you must architect around this constraint: store the large data in S3 and keep a reference in DynamoDB, or split the data across multiple items and reassemble it in your application.

Similarly, SQS messages have a maximum size of 256 KB. If you're building a message-driven application, you need to account for this limit from the start. If you're tempted to send large payloads, you'll need to use the Extended Client Library, which stores the payload in S3 and sends a reference through SQS instead.

API Gateway has a hard limit of 10 MB for request/response payloads. If you're building an API that might receive large uploads, you can't rely on API Gateway alone—you'd need to use presigned S3 URLs to handle large file uploads directly, bypassing the API Gateway limit entirely.

The lesson is this: when you encounter a hard limit, treat it as a design constraint from day one. Don't build a system that relies on increasing it, because you can't.

### Common Soft Limits Worth Knowing

While hard limits are the showstoppers, soft limits define your starting ceiling for growth. Here are some important ones across common services:

**EC2** starts you with limits on the number of instances you can run per region (typically 20 on-demand instances, though this varies by instance type). These are soft limits, easily increased to handle larger deployments.

**RDS** limits the number of databases and snapshots per region. As you scale, you'll likely request increases. The limits exist to prevent accidental resource sprawl but don't restrict legitimate scaling.

**ElastiCache** limits the number of cache clusters and nodes per region. Production systems often request increases to enable robust caching tiers.

**Lambda** concurrent executions, as mentioned, are soft limits. So are the number of simultaneous deployment packages you can store and the timeout duration (initially 15 minutes, adjustable up to 15 minutes... wait, that one's actually a hard limit—a good example of how confusing this gets without clear documentation).

The safest approach is to check the Service Quotas console for any limit you're concerned about, verify the `Adjustable` flag, and plan accordingly.

### Planning for Growth with Quotas

Effective quota management is part of scalability planning. Here's a practical approach:

First, identify which quotas matter for your application. Run a quota discovery phase early in development: list all relevant quotas and note which are soft and which are hard. Document the hard limits prominently in your architecture documentation—they're constraints your system must respect.

Second, monitor your usage against soft limits. Many teams set up CloudWatch alarms or Lambda functions that periodically check quota usage and alert when you've reached 70-80% of a limit. This gives you time to request an increase before you hit the ceiling during peak traffic.

Third, request soft limit increases proactively. Don't wait until you're at the limit. AWS's approval process, while usually quick, can occasionally take longer. Having headroom prevents production incidents where you can't scale because you're at your limit and the increase request hasn't been processed yet.

Fourth, design around hard limits from the start. Don't treat a hard limit as something you'll solve later. Incorporate it into your initial architecture decisions. If DynamoDB's 40 KB item size limit is relevant, settle on your S3 offloading strategy during design, not after you've already built the system.

### Understanding Service Quota Dimensions

Some quotas have dimensions, meaning the limit varies based on a parameter. For instance, API Gateway has different rate limits depending on the stage. DynamoDB on-demand pricing has different soft limits than provisioned mode. Understanding these dimensions prevents confusion.

The Service Quotas API includes dimension information, making it straightforward to query dimension-specific limits. When you're using multiple configurations of a service, ensure you're checking the right quota dimension for your use case.

### The Future of Limits

AWS continuously evaluates limits based on customer feedback and evolving infrastructure. The shift of Lambda's `/tmp` storage from hard to soft is an example of this evolution. As you work with AWS, stay informed about limit changes in services you depend on—they occasionally improve, expanding what's possible without architectural workarounds.

Subscribe to AWS announcements or follow the AWS blog for updates on quota changes. What was a hard limit blocking your scaling yesterday might become adjustable today.

### Conclusion

The distinction between soft and hard limits is fundamental to effective AWS architecture. Soft limits are guardrails—protective defaults that you can increase when your application legitimately needs more capacity. Hard limits are immovable boundaries that demand architectural creativity.

Master the Service Quotas console and API early in your AWS journey. Learn which limits matter for the services you use, identify which are adjustable, and plan accordingly. For hard limits, treat them as constraints from day one, designing your system to respect them. For soft limits, monitor your usage and request increases proactively as you scale.

This discipline prevents the unpleasant surprise of discovering mid-deployment that you've hit a limit you can't move—and more importantly, it lets you build systems that scale cleanly, reliably, and with full awareness of their boundaries.
