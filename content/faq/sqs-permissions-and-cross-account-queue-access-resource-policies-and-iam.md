---
title: "SQS Permissions and Cross-Account Queue Access: Resource Policies and IAM"
---

## SQS Permissions and Cross-Account Queue Access: Resource Policies and IAM

Securing Amazon SQS queues in a multi-account AWS environment requires understanding a dual-layer permission model that often confuses developers. Unlike resources within a single account where IAM identity policies alone suffice, cross-account queue access demands coordination between resource-based policies (attached to the queue itself) and identity-based policies (attached to users and roles). Getting this right is essential not only for security but also for avoiding the frustrating "Access Denied" errors that can plague distributed applications.

In this guide, we'll unpack how SQS security actually works, walk through a realistic cross-account scenario, and explore the principle of least privilege—because granting `*` permissions to queues is a shortcut to regret.

### Understanding SQS Permission Models

AWS uses two complementary authorization mechanisms for SQS: resource-based policies and IAM identity policies. Both must grant permission for an action to succeed—it's an AND relationship, not an OR.

**Resource-based policies** are attached directly to the SQS queue. They define who can do what with that specific queue, regardless of which AWS account the principal belongs to. This is what makes cross-account access possible. When you attach a resource policy to a queue, you're essentially saying, "I trust these specific principals (even those from other accounts) to perform these actions."

**Identity-based policies** are attached to IAM users, roles, or groups. They define what actions a principal can perform across any resource. An IAM policy doesn't care whether the resource is in your account or another account—the policy just says "this principal is allowed to call this API." However, the resource must also grant access.

Think of it this way: if the resource policy is a bouncer's guest list at a club, the identity policy is your ID card. You need both to get in. The bouncer checks the guest list (resource policy), and you show your ID (identity policy). If either says no, you're not getting in.

### The Single-Account Case

Before tackling cross-account scenarios, let's clarify how permissions work within a single account. Suppose you have an IAM role called `MessageConsumer` in Account A, and you want it to receive messages from a queue in Account A.

You only need to attach an identity-based policy to the `MessageConsumer` role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-east-1:123456789012:MyQueue"
    }
  ]
}
```

In this case, you don't need a resource policy on the queue. When a principal in the same account tries to access the queue, AWS checks the identity policy. If it grants permission, the action succeeds. The resource policy is optional for same-account access—AWS has an implicit trust model within a single account.

### Cross-Account Access: Where Resource Policies Become Essential

Now imagine a different scenario: you have a queue in Account A (owned by your payment team), and a Lambda function running in Account B (owned by your billing team) needs to consume messages from it. This is where the dual-layer model becomes critical.

**Account A (Queue Owner)** must attach a resource policy to the queue that explicitly grants Account B's execution role permission to perform SQS actions. Without this policy, Account B's role—no matter how permissive its identity policy—will be denied access.

**Account B (Consumer)** must attach an identity policy to its Lambda execution role granting it permission to call SQS APIs against the queue in Account A.

Let's walk through a concrete example.

### Concrete Cross-Account Scenario

**Setup:**
- Account A (123456789012) owns a queue named `PaymentQueue` in us-east-1
- Account B (210987654321) has a Lambda function that needs to consume messages from this queue
- The Lambda function assumes a role called `LambdaExecutionRole` in Account B

**Step 1: Create the Resource Policy on Account A's Queue**

The queue owner (Account A) must attach a resource policy granting Account B's role permission to receive and delete messages. Log in to Account A and execute:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::210987654321:role/LambdaExecutionRole"
      },
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:us-east-1:123456789012:PaymentQueue"
    }
  ]
}
```

You can attach this via the AWS CLI:

```bash
aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/PaymentQueue \
  --attributes '{"Policy":"{...json policy above...}"}' \
  --region us-east-1
```

Or through the AWS Management Console: navigate to the queue, go to "Access Policy," and paste the policy JSON.

**Step 2: Create the Identity Policy on Account B's Role**

Meanwhile, in Account B, the identity policy attached to `LambdaExecutionRole` must grant permissions for the same SQS actions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes"
      ],
      "Resource": "arn:aws:sqs:us-east-1:123456789012:PaymentQueue"
    }
  ]
}
```

Attach this policy to `LambdaExecutionRole` in Account B.

**Step 3: Test**

When the Lambda function in Account B executes and calls `ReceiveMessage`, AWS evaluates:
1. Does the resource policy (on the queue in Account A) grant the calling principal (Account B's Lambda role) permission? Yes.
2. Does the identity policy (on the Lambda role in Account B) grant permission for this action? Yes.

Both conditions are satisfied, so the call succeeds.

### Least Privilege and Granular SQS Permissions

A common mistake is granting overly broad permissions. The principle of least privilege demands that you grant only the minimum permissions necessary for an application to function.

Common SQS actions and their use cases:

- **sqs:SendMessage**: Required to publish messages to a queue. Grant this to producers.
- **sqs:ReceiveMessage**: Required to consume messages. Grant this to consumers.
- **sqs:DeleteMessage**: Required to remove a message from the queue after processing. Always grant alongside `ReceiveMessage`.
- **sqs:GetQueueAttributes**: Required to inspect queue metadata (message count, retention period, visibility timeout). Many applications need this for monitoring.
- **sqs:PurgeQueue**: Removes all messages. Grant sparingly; rarely needed in production.
- **sqs:SetQueueAttributes**: Modifies queue configuration. Grant only to administrative roles.
- **sqs:ChangeMessageVisibility**: Extends or shortens the visibility timeout of a message. Needed only if your application manages visibility dynamically.

If your Lambda function only consumes messages, grant it exactly `sqs:ReceiveMessage` and `sqs:DeleteMessage`—nothing more. If it also monitors queue depth, add `sqs:GetQueueAttributes`. This approach limits blast radius if credentials are compromised.

A well-scoped identity policy for a message consumer looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-east-1:123456789012:MyQueue"
    }
  ]
}
```

And the corresponding resource policy on the queue (in the account that owns it) should grant the same actions—or a subset if the queue owner wants to be even more restrictive:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::210987654321:role/ConsumerRole"
      },
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-east-1:123456789012:MyQueue"
    }
  ]
}
```

### Common Permission Errors and Troubleshooting

When cross-account SQS access fails, the error messages can be cryptic. Here's how to diagnose common issues.

**Error: "User is not authorized to perform: sqs:ReceiveMessage"**

This typically means the identity policy in the consumer's account doesn't grant the action. Verify that the IAM role or user has an attached policy allowing `sqs:ReceiveMessage` on the target queue's ARN. Check that the ARN in the policy matches the queue exactly (account ID, region, queue name).

**Error: "Access Denied"** (without a specific action)

This is usually a resource policy issue. The queue owner hasn't attached a resource policy, or the policy doesn't include the consumer's role ARN. Double-check:
- Is the consumer's role ARN correct? (Account ID, role name)
- Is the resource policy JSON valid?
- Is the policy attached to the correct queue?

Use the AWS CLI to inspect the queue's current policy:

```bash
aws sqs get-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123456789012/PaymentQueue \
  --attribute-names Policy \
  --region us-east-1
```

If the response shows an empty or missing Policy attribute, the resource policy hasn't been set.

**Error: "Queue does not exist"**

Sometimes this error masks a permission issue. The caller can't list or describe the queue because the identity policy doesn't grant `sqs:ListQueues` or the queue URL is malformed. Ensure the caller's identity policy includes access to the queue, and verify the queue URL is correct.

**Error in CloudWatch Logs: "The security token included in the request is invalid"**

This usually indicates the IAM role doesn't have permission to assume the trust, or credentials are expired. In cross-account scenarios, verify that Account A's queue owner trusts Account B's role in the resource policy, and that Account B's role has a valid trust relationship allowing the Lambda service (or EC2, ECS, etc.) to assume it.

### Resource Policy Syntax Deep Dive

Let's examine a more complex resource policy to understand all the levers you can pull.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccountBToConsume",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::210987654321:role/ConsumerRole"
      },
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-east-1:123456789012:PaymentQueue"
    },
    {
      "Sid": "AllowAccountBToProduce",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::210987654321:role/ProducerRole"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:PaymentQueue"
    },
    {
      "Sid": "DenyUnencryptedTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "sqs:*",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:PaymentQueue",
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

This policy demonstrates:
- **Multiple statements** for different principals and actions. You can grant different permissions to different roles.
- **Sid field**: A human-readable identifier for each statement. Helpful for documentation and troubleshooting.
- **Principal field**: Can reference a specific role ARN (as above), an AWS account ID using `"AWS": "arn:aws:iam::210987654321:root"` to grant permissions to all principals in that account, or `"*"` to grant public access (not recommended).
- **Conditions**: You can add conditions like `aws:SecureTransport` to enforce TLS, IP address restrictions, or time-based access.

### Managing Permissions Across Multiple Queues

In larger systems, you might have multiple queues and roles. Instead of crafting individual resource policies, consider:

**Naming conventions**: Use consistent queue names (e.g., `payment-queue`, `billing-queue`) so you can reference them with wildcards in ARNs.

**Wildcard ARNs**: A resource policy can grant access to multiple queues using wildcards:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::210987654321:role/ConsumerRole"
      },
      "Action": [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage"
      ],
      "Resource": "arn:aws:sqs:us-east-1:123456789012:payment-*"
    }
  ]
}
```

This grants access to any queue starting with `payment-` in that region and account. Use judiciously to avoid over-permissioning.

**Account-level grants**: If you trust another entire account (not just a specific role), you can grant permissions to the root principal of that account:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::210987654321:root"
      },
      "Action": "sqs:*",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:PaymentQueue"
    }
  ]
}
```

This is less secure than role-specific grants because any principal in Account B can potentially access the queue. Use only when you fully trust the other account and have controls in place to restrict who can assume roles there.

### Debugging with IAM Policy Simulator

AWS provides the IAM Policy Simulator to test whether a policy grants a specific action. This is invaluable for troubleshooting.

1. Navigate to the IAM console and select "Policies" from the left sidebar.
2. Click "Policy Simulator" at the top right.
3. Select the IAM user or role to simulate.
4. Choose the SQS service.
5. Select the action (e.g., `ReceiveMessage`).
6. Enter the queue ARN.
7. Click "Simulate Custom Policy" (if testing a new policy) or "Run Simulation" (if testing an existing role).

The simulator shows whether each policy grants or denies the action and why. This is much faster than trial-and-error in production.

You can also simulate a resource policy by entering it as a custom policy and testing whether a cross-account principal can perform an action.

### Queue Permissions in Serverless Architectures

In modern architectures, SQS often integrates with Lambda, API Gateway, or EventBridge. Understanding permissions in these contexts is critical.

**Lambda as a Consumer**: Your Lambda function's execution role needs identity-based permissions for `sqs:ReceiveMessage` and `sqs:DeleteMessage`. If the queue is in another account, the queue owner must also attach a resource policy granting the Lambda role access.

**Lambda as a Producer**: If Lambda publishes to an SQS queue in another account, grant the Lambda role `sqs:SendMessage` in its identity policy, and the queue owner must allow the role in the resource policy.

**EventBridge as a Producer**: EventBridge can trigger SQS directly. You don't need explicit SQS permissions on the EventBridge side—EventBridge uses a service-linked role to call SQS on your behalf. However, the queue's resource policy must allow the EventBridge service principal (`events.amazonaws.com`) or the specific event bus's role. A typical resource policy for this looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "events.amazonaws.com"
      },
      "Action": "sqs:SendMessage",
      "Resource": "arn:aws:sqs:us-east-1:123456789012:EventTargetQueue",
      "Condition": {
        "ArnEquals": {
          "aws:SourceArn": "arn:aws:events:us-east-1:123456789012:rule/MyEventRule"
        }
      }
    }
  ]
}
```

**API Gateway as a Producer**: If an API endpoint publishes to SQS, similar patterns apply. The API's execution role needs identity permissions, and the queue needs a resource policy (if cross-account) or implicit trust (if same-account).

### Encryption and Key Policies

If your SQS queue uses server-side encryption with a customer-managed KMS key, permissions become more complex. The queue's resource policy grants access to SQS actions, but the KMS key policy must also allow the principal to encrypt and decrypt messages.

When you call `SendMessage` on an encrypted queue, AWS encrypts the message using the KMS key. The caller needs `kms:Decrypt` and `kms:GenerateDataKey` permissions on the key.

Similarly, `ReceiveMessage` requires `kms:Decrypt`.

The KMS key policy might look like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowAccountBToUseKey",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::210987654321:role/ConsumerRole"
      },
      "Action": [
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": "*"
    }
  ]
}
```

Remember: both the SQS resource policy and the KMS key policy must grant permission for cross-account encrypted message access to work.

### Testing and Validation

Before rolling out a cross-account SQS setup to production, validate permissions thoroughly.

**Manual Test**: Write a simple Python script using Boto3 to test `ReceiveMessage`:

```python
import boto3

sqs = boto3.client('sqs', region_name='us-east-1')

try:
    response = sqs.receive_message(
        QueueUrl='https://sqs.us-east-1.amazonaws.com/123456789012/PaymentQueue',
        MaxNumberOfMessages=1
    )
    print("Success! Messages:", response.get('Messages', []))
except Exception as e:
    print("Error:", str(e))
```

Run this from Account B (using the appropriate credentials or role). If it fails, the error message will indicate whether the issue is a missing resource policy, identity policy, or KMS key permission.

**CloudTrail Logging**: Enable CloudTrail in both accounts to audit SQS API calls. When an access denied error occurs, check CloudTrail for the detailed error reason. This is invaluable for troubleshooting.

**Monitoring**: Use CloudWatch to monitor `ApproximateNumberOfMessagesVisible` and `NumberOfMessagesSent/Received`. A sudden drop in received messages might indicate permission issues.

### Best Practices Summary

**Principle of Least Privilege**: Grant only the minimum permissions needed. If a role only consumes messages, don't grant `SendMessage` or `SetQueueAttributes`.

**Use Specific ARNs**: Reference specific queue ARNs rather than wildcards when possible. This limits the blast radius of a compromised credential.

**Separate Producer and Consumer Roles**: Don't grant both `SendMessage` and `ReceiveMessage` to the same role unless necessary. This reduces risk.

**Document Resource Policies**: Add descriptive SIDs and comments in your resource policies explaining why each principal has access.

**Audit Regularly**: Review queue resource policies and associated identity policies quarterly. Remove access for roles or accounts that no longer need it.

**Use Resource Tags**: Tag queues with `Environment`, `Owner`, and `CostCenter`. This helps with resource governance and troubleshooting.

**Enable Encryption**: Use customer-managed KMS keys for sensitive queues and ensure both the queue resource policy and the key policy grant appropriate access.

**Test Across Accounts**: Before production, test SQS communication between accounts in a non-production environment.

### Conclusion

Cross-account SQS access might seem complex, but it follows a straightforward model: the queue owner attaches a resource policy granting external principals permission, and those principals must also have identity policies allowing the same actions. The dual-layer authorization ensures that both the resource owner and the principal's account owner have authorized the access.

By understanding the distinction between resource policies and identity policies, applying the principle of least privilege, and systematically testing your configuration, you can build secure, multi-account architectures that keep your message queues protected while enabling seamless inter-account communication. The investment in getting permissions right upfront pays dividends in security, maintainability, and operational peace of mind.
