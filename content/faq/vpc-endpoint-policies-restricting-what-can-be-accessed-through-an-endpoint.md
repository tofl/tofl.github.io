---
title: "VPC Endpoint Policies: Restricting What Can Be Accessed Through an Endpoint"
---

## VPC Endpoint Policies: Restricting What Can Be Accessed Through an Endpoint

When you create a VPC endpoint to connect your private resources directly to AWS services without traversing the public internet, you gain more than just convenience—you gain a powerful security boundary. But creating an endpoint isn't enough. Like leaving a door unlocked just because you've installed it, an endpoint without proper policy controls can become a security vulnerability. VPC endpoint policies are the mechanism that lets you lock down exactly what traffic is allowed through that door, adding a critical layer of defense that sits between your applications and the services they consume.

In this article, we'll explore how endpoint policies work, how they differ from other policy types you might already know, and how to craft them to enforce least-privilege access in a defense-in-depth security architecture.

### Understanding the Three Layers of Access Control

Before diving into endpoint policies themselves, it helps to clarify how they fit into the broader landscape of AWS access control. When you try to access a resource through a VPC endpoint, three separate policy evaluations typically happen, and all three must allow the action for it to succeed.

The first layer is your IAM policy—the permissions you've granted to the principal (a user, role, or service) making the request. If you're an EC2 instance with a role that allows `s3:GetObject` on a specific bucket, that's your starting point. Without the right IAM permissions, nothing downstream will help you.

The second layer is the resource policy, such as an S3 bucket policy or SNS topic policy. This policy lives on the service side and controls who can access that specific resource, regardless of how the request arrives. An S3 bucket policy might say, "only allow requests from a specific AWS account," or "only allow requests from a particular role."

The third layer—and the one we're focusing on here—is the VPC endpoint policy. This policy is attached directly to the endpoint itself and acts as a gate specifically for traffic flowing through that endpoint. It's independent of both IAM and resource policies, adding an extra checkpoint. Think of it this way: your IAM permissions get you to the endpoint gate, the endpoint policy decides whether traffic through the gate is allowed, and the resource policy makes the final determination at the destination.

All three must align for access to succeed. This layered approach is what makes VPC endpoints such a powerful security tool—you're not just relying on a single authorization decision.

### How VPC Endpoint Policies Work as a Traffic Filter

A VPC endpoint policy operates as a whitelist (or blacklist, though whitelisting is the security best practice). When you attach a policy to a VPC endpoint, you're explicitly defining which API calls, principals, and resources are permitted through that endpoint.

Here's a concrete scenario: imagine you have a VPC endpoint for S3 and multiple applications in your VPC. One application needs read-only access to a specific bucket for customer data, while another application needs to write logs to a different bucket. Without an endpoint policy, if you grant write permissions to both applications via IAM, they could both access both buckets through the endpoint. An endpoint policy lets you restrict traffic at the endpoint level, ensuring the read-only application can never write to the logging bucket, even if the IAM permissions accidentally allowed it.

The endpoint policy evaluates every request that passes through the endpoint. If the request matches the conditions and actions specified in the policy, it's allowed. If not, it's denied. This happens in addition to—not instead of—IAM and resource policy checks.

A crucial point: if you don't attach any policy to a VPC endpoint, AWS applies a default policy that allows all traffic. This is convenient during development but represents a security risk in production. You should always explicitly define what's allowed rather than relying on permissive defaults.

### Anatomy of a VPC Endpoint Policy

VPC endpoint policies follow the same JSON structure as IAM policies, but they're specifically designed to work in the context of an endpoint. Let's break down a practical example.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-data-bucket/*"
    }
  ]
}
```

This policy allows anyone with access to the VPC to perform `GetObject` operations on objects in `my-data-bucket`. The `Principal` is set to `*`, meaning the endpoint doesn't discriminate based on who's making the call—that's the job of IAM and resource policies. The `Action` restricts the operation to reading objects, not deleting or uploading. The `Resource` limits it to a specific bucket.

In a more restrictive scenario, you might want to allow multiple actions but only on a specific bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::my-app-bucket/*"
    },
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::my-app-bucket"
    }
  ]
}
```

Notice that we have two statements: one for object-level operations and one for bucket-level operations. S3 distinguishes between these, so you need to be specific about which ARN you're targeting.

In a gateway endpoint scenario where you want to be even more restrictive, you could deny specific actions rather than explicitly allow them:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": "*"
    },
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": [
        "s3:DeleteBucket",
        "s3:DeleteBucketPolicy",
        "s3:PutBucketPolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

This approach allows broad S3 access through the endpoint but explicitly blocks destructive operations. While this works, it's generally considered less secure than explicitly allowing only what you need, because it relies on you remembering to deny every dangerous action.

### Enforcing Single-Endpoint Access with aws:SourceVpce

One of the most powerful uses of VPC endpoint policies is enforcing that resources can only be accessed through a specific endpoint. This is done in combination with the `aws:SourceVpce` condition key, which you place in the resource policy (like an S3 bucket policy), not the endpoint policy itself.

Here's how it works: you configure your S3 bucket policy to only allow requests that originate from a specific VPC endpoint. This ensures that even if someone manages to access your bucket through another route—say, the public S3 endpoint over the internet—the bucket policy will deny the request.

An S3 bucket policy with this restriction looks like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/MyAppRole"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-sensitive-bucket/*",
      "Condition": {
        "StringEquals": {
          "aws:SourceVpce": "vpce-12345678"
        }
      }
    }
  ]
}
```

This bucket policy says: allow `GetObject` operations, but only if the request comes through the VPC endpoint with ID `vpce-12345678`. Even if an application has the right IAM permissions and tries to access the bucket through the public internet, this condition will fail and the request will be denied.

You can also use `aws:SourceVpc` to restrict access to a specific VPC, but `aws:SourceVpce` is more granular and secure because it locks down access to a specific endpoint, not just any resource in a VPC. This matters in scenarios where you have multiple VPCs or multiple endpoints in the same VPC, and you want to ensure traffic flows through exactly the right one.

### Combining Endpoint and Bucket Policies for Defense in Depth

The real power of VPC endpoint security emerges when you layer the policies thoughtfully. Let's walk through a realistic scenario: you have a private application that needs read-only access to customer data in S3, and you want to ensure that access is as restricted as possible.

Your VPC endpoint policy would look like this:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::customer-data/*"
    }
  ]
}
```

This endpoint policy says: only read operations are allowed through this endpoint, and only for the customer data bucket.

Your S3 bucket policy adds another layer:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/AppRole"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::customer-data/*",
      "Condition": {
        "StringEquals": {
          "aws:SourceVpce": "vpce-87654321"
        }
      }
    }
  ]
}
```

The bucket policy says: only the `AppRole` can access this bucket, and only through the specific endpoint.

Finally, the IAM policy attached to the role grants the actual permission:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::customer-data/*"
    }
  ]
}
```

Now, let's trace through what happens when the application tries to read an object:

1. The application's IAM role has `s3:GetObject` permission on the bucket—check.
2. The request hits the VPC endpoint, which checks its policy. The action is `GetObject`, which matches—check.
3. The S3 bucket policy checks: is the request from the right role? Yes. Is it coming through the right endpoint? Yes—check.
4. The object is returned.

If any of these checks failed—say, the request tried to use `PutObject` instead of `GetObject`—it would be denied at the endpoint layer before even hitting the bucket policy. If someone somehow tried to access the bucket without going through the endpoint, the bucket policy would catch it. This is defense in depth: multiple layers, each capable of catching an unauthorized request.

### Common Patterns and Best Practices

When designing endpoint policies, a few patterns have proven themselves in production environments.

**The least-privilege approach** means explicitly allowing only the actions and resources your application actually needs. This requires you to know your application's access patterns, but it's worth the effort. Start restrictive and expand only when necessary, rather than starting permissive and hoping to restrict later.

**Service-specific considerations** matter too. DynamoDB endpoints, for instance, allow you to restrict access based on table names or indexes. SNS and SQS endpoints let you control which topics or queues are accessible. Spend time understanding what conditions and resources are meaningful for the specific service you're protecting.

**Combining Principal conditions** with resource conditions provides additional flexibility. For example, you might allow different actions based on which IAM principal is making the request, or you might restrict certain principals to certain resources within an endpoint.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/ReadOnlyRole"
      },
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::data-bucket",
        "arn:aws:s3:::data-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/AdminRole"
      },
      "Action": "s3:*",
      "Resource": "*"
    }
  ]
}
```

This endpoint policy allows read-only roles limited access while admin roles have broader permissions, all filtered through the same endpoint.

**Testing your policies** is essential. A common gotcha is accidentally denying legitimate traffic because a condition is too restrictive or an action is misspelled. Before deploying a policy to production, test it with a non-critical application or in a staging environment. AWS CloudTrail and VPC Flow Logs can help you understand what traffic is being allowed or denied.

### Troubleshooting and Common Mistakes

When access through a VPC endpoint stops working, developers often assume the endpoint itself is broken. Usually, it's a policy issue. Here's how to debug it.

First, check whether the endpoint policy is blocking the request. Look at CloudTrail logs to see the exact API call being made. Cross-reference that with your endpoint policy to see if the action and resource match your Allow statements. If they don't, the endpoint policy is your culprit.

Second, verify the IAM permissions. Even if the endpoint policy allows an action, the principal still needs IAM permissions. Use the IAM policy simulator in the AWS console or CLI to test whether a specific principal can perform the action.

Third, check the resource policy if there is one. For S3, this is the bucket policy. Make sure the principal is allowed, and if you're using `aws:SourceVpce`, verify that you're using the correct endpoint ID. A common mistake is copy-pasting an endpoint ID from a different VPC or region.

Fourth, consider the effect of deny statements. An explicit deny anywhere in the policy chain always wins, even if there's an allow elsewhere. If you have a deny statement in your endpoint policy that's too broad, it can block legitimate traffic.

Finally, remember that endpoint policies don't override IAM permissions—they supplement them. If an IAM policy explicitly denies an action, no endpoint policy can allow it. The principle of least privilege should be applied consistently across all three layers.

### VPC Endpoint Policies in a Security Architecture

In a well-architected security posture, VPC endpoints with proper policies are a cornerstone. They reduce the attack surface by keeping traffic off the public internet, they provide a choke point where you can enforce access controls, and they work beautifully with other AWS security features like network ACLs, security groups, and resource-based policies.

When you're designing a system that handles sensitive data, consider VPC endpoints as a given, not an optional extra. Pair them with endpoint policies that explicitly allow only what's necessary, bucket policies that enforce endpoint-based access, and IAM policies that follow least-privilege principles. This multi-layered approach means that a breach in one system doesn't automatically compromise the others.

Endpoint policies also make auditing easier. When you have a clear, restrictive endpoint policy, you can quickly understand what traffic is supposed to flow through that endpoint. You can set up CloudTrail to log all API calls and verify that traffic aligns with your policy. You can use VPC Flow Logs to see the network traffic itself. All of this contributes to the visibility and control that modern security requires.

### Conclusion

VPC endpoint policies are a deceptively simple mechanism with profound security implications. By understanding how they fit into the broader access control landscape alongside IAM and resource policies, you can design systems that are both secure and functional. The key is thinking in layers: each policy is a separate checkpoint, and all must align for access to be granted. Start with the principle of least privilege, explicitly allow only what's necessary, and test your policies thoroughly before deploying to production. When you combine restrictive endpoint policies with bucket policies that enforce endpoint-based access through the `aws:SourceVpce` condition, you create a security posture that's resilient against many common attack vectors and configuration mistakes. In a world where security breaches are increasingly costly, that layered defense is time well invested.
