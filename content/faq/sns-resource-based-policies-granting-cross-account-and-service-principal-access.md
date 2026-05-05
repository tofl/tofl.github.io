---
title: "SNS Resource-Based Policies: Granting Cross-Account and Service Principal Access"
---

# SNS Resource-Based Policies: Granting Cross-Account and Service Principal Access

When you're building distributed systems on AWS, you'll inevitably encounter scenarios where you need to grant permissions that cross account boundaries or allow AWS services to publish to your SNS topics. This is where understanding SNS resource-based policies becomes essential. Unlike IAM identity policies, which you attach to users, roles, or groups, resource-based policies live directly on AWS resources themselves. They're the gatekeepers that decide who—or what—can take actions on an SNS topic.

In this article, we'll explore how SNS resource-based policies work, why they're different from and complementary to IAM identity policies, and how to construct them for common real-world scenarios. By the end, you'll be confident building policies that enable cross-account access, service-to-service integrations, and secure multi-tenant architectures.

### Why Resource-Based Policies Matter

To appreciate why SNS resource-based policies exist, consider this scenario: you've built an application in Account A that processes events from an S3 bucket in Account B. The S3 bucket is configured to send notifications to an SNS topic that lives in Account A. How does the S3 service in Account B gain permission to publish to a topic it doesn't own?

The answer reveals a fundamental limitation of IAM identity policies. An identity policy attached to a user or role in Account B can't grant permissions on resources owned by Account A—it's completely outside that account's control. This is by design; it prevents account A from being impacted by identity policies in other accounts. To solve this problem, the resource owner (Account A) must explicitly grant permission using a resource-based policy attached to the SNS topic itself.

Resource-based policies are also the mechanism by which AWS managed services—like S3, CloudWatch, or EventBridge—can interact with resources they don't own. When you configure S3 to send notifications to an SNS topic, AWS needs a way for the S3 service principal to access that topic. Again, a resource-based policy provides that gateway.

### Identity Policies Versus Resource-Based Policies

Let's establish a clear mental model of how these two types of policies interact.

An IAM identity policy is attached to a principal—a user, role, or group—and it says, "This principal is allowed to do X on resource Y." The principal in Account A might have a policy saying, "I can invoke a Lambda function in my account." Simple and contained.

A resource-based policy, by contrast, is attached to the resource itself. It says, "Any principal matching this criteria can do X on me." The SNS topic in Account A might have a policy saying, "The S3 service principal is allowed to publish to me," or "Any principal from Account B with role X is allowed to subscribe."

Critically, both must be satisfied for an action to succeed. This is the "two-policy evaluation logic" that underpins AWS access control. Imagine you have an SNS topic with a resource policy that grants Account B publish permissions. A principal in Account B still needs an identity policy that explicitly allows the sns:Publish action on that topic. If either policy says no—or neither says yes—the action is denied.

This dual-evaluation model might seem verbose, but it's powerful. It means resources are protected by default; a principal must be granted permission both by its own identity policy *and* by the resource's resource-based policy.

### Understanding the SNS Topic Policy Structure

An SNS topic policy is a JSON document with a specific structure. Let's break it down:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublishFromS3",
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:my-topic"
    }
  ]
}
```

The `Version` is standard—always use `2012-10-17`. Each statement in the `Statement` array defines a single permission grant. The `Sid` (statement ID) is optional but recommended for clarity, especially when debugging policies with multiple statements.

The `Principal` field is what makes resource-based policies different from identity policies. Here, you specify who is being granted permission. The principal can be:

- An AWS account: `"Principal": {"AWS": "arn:aws:iam::ACCOUNT-ID:root"}`
- An IAM user or role: `"Principal": {"AWS": "arn:aws:iam::ACCOUNT-ID:user/username"}` or `arn:aws:iam::ACCOUNT-ID:role/rolename`
- An AWS service: `"Principal": {"Service": "s3.amazonaws.com"}`
- Everyone: `"Principal": "*"` (use with caution and conditions)

The `Action` specifies what the principal can do. For SNS, common actions include `sns:Publish`, `sns:Subscribe`, and `sns:Receive`. You can specify a single action as a string or multiple actions as an array.

The `Resource` field specifies which resource(s) the statement applies to. For a topic-level policy, this is typically the topic's ARN. When writing topic policies directly (as opposed to queue or bucket policies), the Resource almost always matches the topic you're attaching it to, though the policy engine does support wildcards if you're granting permissions across multiple topics.

The `Condition` block is optional but powerful. It lets you restrict access based on context, such as source IP, principal's organization, time of day, or encryption status. We'll explore conditions in depth later.

### Granting S3 Publish Permissions to an SNS Topic

One of the most common use cases is configuring an S3 bucket to send notifications to an SNS topic. Let's walk through a realistic example.

Imagine you have a data processing workflow where files uploaded to an S3 bucket should trigger notifications to an SNS topic. The topic fans out those notifications to Lambda functions, email subscribers, or downstream systems. Both the bucket and the topic are in the same AWS account, but the principle applies even if they're in different accounts.

The S3 service needs permission to publish to the topic. Here's the resource policy you'd attach to the SNS topic:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3Publish",
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:my-data-topic"
    }
  ]
}
```

This statement grants the S3 service permission to publish to the specific topic. But in a large organization, you might want to be more specific: allow only a particular S3 bucket to publish. You'd add a condition:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3BucketPublish",
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:my-data-topic",
      "Condition": {
        "ArnLike": {
          "aws:SourceArn": "arn:aws:s3:::my-specific-bucket"
        }
      }
    }
  ]
}
```

The `aws:SourceArn` condition restricts the statement to apply only when the request originates from the specified S3 bucket. Now, if any other bucket tries to publish to this topic, the action is denied, even if it somehow has the necessary identity policy.

To apply this policy to your topic via the AWS CLI, you'd use:

```bash
aws sns set-topic-attributes \
  --topic-arn arn:aws:sns:us-east-1:123456789012:my-data-topic \
  --attribute-name Policy \
  --attribute-value file://policy.json \
  --region us-east-1
```

### Cross-Account Access: Granting Another AWS Account Permissions

Now let's consider a more complex scenario: you own an SNS topic in Account A, and you want to allow a principal in Account B to publish to it. This is where resource-based policies truly shine.

The principal in Account B needs two things. First, they need an identity policy in their own account that explicitly allows the sns:Publish action:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublishToRemoteTopic",
      "Effect": "Allow",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:shared-topic"
    }
  ]
}
```

Notice the Resource ARN includes Account A's ID (`123456789012`). The principal in Account B needs to know which topic they're targeting; they can't grant themselves permissions on resources they don't own.

Second, you—the topic owner in Account A—must attach a resource policy to the topic that permits Account B's principal to act:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccountBPublish",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::987654321098:role/DataPublisher"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:shared-topic"
    }
  ]
}
```

Here, `987654321098` is Account B's ID, and `DataPublisher` is the role in that account that will publish to the topic. This statement is explicit: it names the exact principal being granted access.

If you want to grant all principals in Account B (not just a specific role), you can use the account's root ARN:

```json
{
  "Principal": {
    "AWS": "arn:aws:iam::987654321098:root"
  }
}
```

This grants access to any principal in Account B that has the necessary identity policy. It's more permissive but still scoped to a single account, which is often the right balance between convenience and security.

### Using Wildcards and Conditions Responsibly

The `Principal` field accepts wildcards, but use them carefully. The most permissive wildcard is `"Principal": "*"`, which means anyone in the world, if they can somehow authenticate to AWS, can perform the action. This is rarely appropriate for SNS publish permissions but might make sense for read-only operations like viewing topic metadata.

If you must use a wildcard principal, you *must* restrict the statement with conditions. Here's an example where we allow everyone to publish, but only from a specific IP range:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowPublishFromCorpNetwork",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:internal-topic",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "203.0.113.0/24",
            "198.51.100.0/24"
          ]
        }
      }
    }
  ]
}
```

This is safer than an unrestricted wildcard, but even better would be to list specific principals if you know them. The principle of least privilege applies to resource-based policies just as it does to identity policies.

Another useful condition is restricting by organization. If you're part of an AWS Organization, you can grant access to any principal within your organization:

```json
{
  "Condition": {
    "StringEquals": {
      "aws:PrincipalOrgID": "o-1234567890"
    }
  }
}
```

This approach balances flexibility—you don't need to update the policy as new accounts join your organization—with security—you're still restricting access to your organizational boundary.

### Allowing Multiple Services and Accounts

In practice, your SNS topic often needs to accept messages from multiple sources. You can add multiple statements to your policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3Publish",
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:multi-source-topic",
      "Condition": {
        "ArnLike": {
          "aws:SourceArn": "arn:aws:s3:::bucket-a"
        }
      }
    },
    {
      "Sid": "AllowCloudWatchPublish",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudwatch.amazonaws.com"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:multi-source-topic"
    },
    {
      "Sid": "AllowAccountBPublish",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::987654321098:role/DataPipeline"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:multi-source-topic"
    }
  ]
}
```

Each statement is independently evaluated. If any statement allows an action and no deny statements block it, the action succeeds. This design lets you build policies incrementally and makes it easier to understand what each section does.

### Subscription Permissions and sns:Receive

Publishing to a topic is one thing; subscribing to it is another, and they require different permissions. To allow a principal in another account to subscribe to your topic, you'd grant the `sns:Subscribe` action:

```json
{
  "Sid": "AllowAccountBSubscribe",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::987654321098:root"
  },
  "Action": "sns:Subscribe",
  "Resource": "arn:aws:sns:us-east-1:123456789012:shared-topic"
}
```

The `sns:Receive` action is different—it allows a principal to receive messages from a subscription. This is primarily relevant for applications polling an SNS subscription (which is uncommon; SNS is push-based) or when using SNS with SQS (where SQS subscribers receive messages on behalf of their applications).

For most use cases, you'll focus on `sns:Publish` and `sns:Subscribe`, but understanding the nuances of different actions helps you build more secure policies.

### Troubleshooting AccessDenied Errors

When you encounter an `AccessDenied` error while interacting with an SNS topic, it's usually because one of three conditions is true: the principal lacks an identity policy, the topic lacks a matching resource policy, or a condition in either policy is being violated.

The debugging process is systematic. First, verify that the principal has an identity policy allowing the action on the resource. Log in as or assume the role of the principal and check their attached policies. Make sure the SNS topic ARN matches exactly; ARNs are case-sensitive and must include the correct region and account ID.

Second, check the topic's resource policy. View it via the AWS CLI:

```bash
aws sns get-topic-attributes \
  --topic-arn arn:aws:sns:us-east-1:123456789012:my-topic \
  --attribute-name Policy \
  --region us-east-1
```

The output will include the full policy document. Verify that there's a statement allowing the principal in question. Pay careful attention to the Principal field—is it specifying the exact role ARN, or a wildcard, or the account root? Is there a condition that might be filtering out the request?

Third, examine any conditions. If you're testing from a corporate network and the policy includes an IP condition, make sure your request is actually coming from that IP range. If you're cross-account, verify the account ID in the principal ARN. If the policy uses `aws:SourceArn`, ensure the source making the request matches the specified ARN.

A particularly tricky scenario occurs when you're testing cross-account access. You assume a role in Account B, but the policy in Account A is looking for the role's ARN. When you assume a role, you temporarily become that role, so the principal context of your request is indeed the role ARN. Similarly, if you're using a policy with `aws:PrincipalOrgID`, ensure the account is actually part of the organization you're specifying.

### Best Practices for SNS Resource Policies

As you design SNS resource policies, keep these practices in mind:

Start with the principle of least privilege. Grant only the specific actions needed—`sns:Publish`, `sns:Subscribe`, etc.—to only the principals who need them. Avoid overly broad wildcards or service principals unless you have a compelling reason.

Use conditions liberally. Whether you're allowing S3 to publish or granting cross-account access, conditions reduce your blast radius. Conditions on `aws:SourceArn`, `aws:SourceAccount`, or IP addresses are excellent defensive measures.

Document your policies with clear statement IDs and, if possible, comments explaining why each permission exists. In a team environment, this makes future maintenance much easier.

Regularly audit topic policies as part of your security posture. Over time, policies accumulate statements for old projects or integrations that are no longer needed. Periodic reviews help you identify and remove stale permissions.

Test your policies in a non-production environment first. Use the AWS CLI or SDKs to simulate requests and verify that authorized principals can perform actions while unauthorized ones are blocked.

Be aware that a resource policy is not a substitute for encryption or other security controls. A policy allows or denies access, but once access is granted, the principal can perform the action. If the topic carries sensitive data, consider encrypting messages at rest and in transit.

### Common Real-World Patterns

Let's look at a few patterns you're likely to encounter in production systems.

The first is the logging and monitoring pattern. You have a central logging account where all your applications send logs and metrics. CloudWatch Logs in each member account publishes to an SNS topic in the central account, which then fans out to your security or operations team. The resource policy allows the CloudWatch service and specific member accounts to publish:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCloudWatchPublish",
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudwatch.amazonaws.com"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:central-logs-topic"
    },
    {
      "Sid": "AllowMemberAccountsPublish",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::987654321098:root",
        "AWS": "arn:aws:iam::876543210987:root"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:central-logs-topic",
      "Condition": {
        "StringEquals": {
          "aws:SourceAccount": [
            "987654321098",
            "876543210987"
          ]
        }
      }
    }
  ]
}
```

The second is the event-driven data pipeline. A data lake account owns an SNS topic that notifies subscribers when new data is available. Analytics and ML teams in other accounts subscribe to the topic and process the data. The resource policy allows cross-account subscriptions but restricts publishing to the data lake's own services:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowS3PublishDataEvents",
      "Effect": "Allow",
      "Principal": {
        "Service": "s3.amazonaws.com"
      },
      "Action": "sns:Publish",
      "Resource": "arn:aws:sns:us-east-1:123456789012:data-availability-topic",
      "Condition": {
        "ArnLike": {
          "aws:SourceArn": "arn:aws:s3:::data-lake-*"
        }
      }
    },
    {
      "Sid": "AllowCrossAccountSubscribe",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::987654321098:root",
        "AWS": "arn:aws:iam::876543210987:root"
      },
      "Action": "sns:Subscribe",
      "Resource": "arn:aws:sns:us-east-1:123456789012:data-availability-topic"
    }
  ]
}
```

The third is the webhook or third-party integration. You want to allow an external service or a partner's AWS account to receive notifications. You'd grant subscription and receive permissions, possibly with additional conditions to ensure the requesting account is actually your partner:

```json
{
  "Sid": "AllowPartnerAccount",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111122223333:root"
  },
  "Action": [
    "sns:Subscribe",
    "sns:Receive"
  ],
  "Resource": "arn:aws:sns:us-east-1:123456789012:partner-notifications-topic",
  "Condition": {
    "StringEquals": {
      "aws:SourceAccount": "111122223333"
    }
  }
}
```

These patterns show that resource policies are flexible enough to support a wide variety of architectures, from simple same-account integrations to complex multi-account setups.

### Conclusion

SNS resource-based policies are your primary tool for enabling secure, controlled access to SNS topics across account boundaries and between AWS services. They complement IAM identity policies to create a two-layer authorization model that keeps resources protected by default while allowing for sophisticated access patterns.

The key takeaway is that resource-based policies live on the resource itself and explicitly grant permission to principals outside your direct identity control. Combined with thoughtful use of conditions and the principle of least privilege, they let you build distributed systems that are both flexible and secure.

As you work with SNS in multi-account environments or integrate it with other AWS services, remember that every statement you add to a resource policy should be intentional and documented. Test your configurations in non-production environments, and periodically audit your policies to ensure they still reflect your actual security requirements. With these practices in place, you'll build systems that scale safely and support the kinds of service-to-service and cross-organization integrations that modern cloud architectures demand.
