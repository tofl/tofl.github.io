---
title: "Securing EventBridge Buses: IAM, Resource Policies, and Encryption"
---

## Securing EventBridge Buses: IAM, Resource Policies, and Encryption

Event-driven architectures have become central to modern cloud applications, and Amazon EventBridge sits at the heart of many of them. But with great power comes the responsibility to secure it properly. EventBridge controls the flow of data between services, often carrying sensitive information—customer records, payment details, authentication tokens, and more. If you don't get the security right, you're essentially leaving doors unlocked in your event pipeline.

The challenge is that EventBridge's security model operates across multiple layers: identity-based access control through IAM, resource-based policies on the buses themselves, encryption at rest and in transit, and even subtle security considerations around how you transform and route events. Mastering these layers is essential not just for passing rigorous technical interviews, but for building systems that actually protect your data in production.

This article walks you through EventBridge's complete security landscape. We'll examine how IAM permissions gate who can perform actions like publishing events and managing rules, how resource policies control who can access your buses, how encryption protects events at rest, and how to architect your event transformations to prevent accidental data leakage. By the end, you'll understand how to apply least-privilege principles to event-driven systems and make informed security decisions at every layer.

### Understanding EventBridge's Security Model

Before diving into specific controls, it's useful to understand how EventBridge thinks about security holistically. EventBridge uses a layered approach: first, identity-based access control determines what actions a principal (user, role, or service) can perform; second, resource-based policies gate access to specific buses; third, encryption protects data at rest; and fourth, careful design of event transformations prevents sensitive data from reaching unintended targets.

Think of it like securing a physical building. IAM is the badge system that controls who gets into the building and what floors they can access. Resource policies are the additional locks on specific rooms. Encryption is the safe where you store valuables. And input transformers are the policies about what information you actually write down before filing it away.

EventBridge operates with a principle fundamental to all AWS security: explicit allow, implicit deny. Nothing happens until you grant permission. This is a powerful guarantee, but it also means you need to be deliberate about what you allow.

### Identity-Based Access Control: IAM Permissions for EventBridge

IAM permissions in EventBridge control what actions a principal can take. The most critical permissions for developers working with EventBridge are `events:PutEvents` (publishing events), `events:PutRule` (creating rules), `events:PutTargets` (adding targets to rules), and various management actions like `events:DescribeRule` and `events:ListRules`.

When you call `PutEvents` to send an event to an EventBridge bus, you're making an API call that AWS needs to authorize. If your application doesn't have the `events:PutEvents` permission, the call fails, regardless of who owns the bus or how it's configured. This is the first gate.

Here's what a minimal IAM policy for an application that only publishes events to a specific bus might look like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:us-east-1:123456789012:event-bus/my-application-bus"
    }
  ]
}
```

Notice we've scoped this to a specific bus using the ARN. This is important: a principal with `events:PutEvents` on just this bus can't accidentally—or maliciously—publish events to other buses in your account.

But publishing is only one aspect. If your application also needs to manage its own rules (perhaps dynamically creating event filters), you'd need additional permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "events:PutRule",
        "events:PutTargets",
        "events:RemoveTargets",
        "events:DeleteRule"
      ],
      "Resource": "arn:aws:events:us-east-1:123456789012:rule/my-application-bus/*"
    }
  ]
}
```

Here we're allowing rule management, but we've scoped it to rules on a specific bus (note the wildcard at the end—we're saying rules matching the pattern, not all rules). This prevents the application from accidentally modifying rules on buses it shouldn't touch.

A common mistake is overly broad permissions like `events:*` on `Resource: *`. While this might work in a dev environment, it violates the principle of least privilege. In production, if an application is compromised, an attacker with unlimited EventBridge permissions could intercept, redirect, or delete critical events, potentially disrupting your entire system.

### Resource-Based Policies: Controlling Access to Buses

While IAM permissions control what a principal can do, resource-based policies control who can access a specific bus. This distinction matters, especially when you have cross-account or cross-principal scenarios.

EventBridge buses, both custom and the default bus, can have resource-based policies attached to them. These policies describe which principals (potentially from other AWS accounts, or other services) are allowed to perform actions on that bus.

Let's say you have a bus in Account A that receives events from a Lambda function in Account B. The Lambda function in Account B has an IAM role with `events:PutEvents` permission, but that's not enough—the bus itself must also explicitly allow Account B to put events to it.

Here's what the resource policy on the bus in Account A might look like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:role/LambdaRole"
      },
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:us-east-1:123456789012:event-bus/shared-bus"
    }
  ]
}
```

This policy says: the Lambda role in Account B is allowed to put events to this specific bus in Account A. Without this resource policy, the cross-account `PutEvents` call fails, even if the role has IAM permissions.

You can also use principal wildcards for service-based access. For instance, if you want any Lambda function in your account to publish to a bus, you might write:

```json
{
  "Effect": "Allow",
  "Principal": {
    "Service": "lambda.amazonaws.com"
  },
  "Action": "events:PutEvents",
  "Resource": "arn:aws:events:us-east-1:123456789012:event-bus/public-bus"
}
```

This grants permission to the Lambda service, meaning any Lambda function (with the right IAM permissions) in your account can publish to this bus. This is useful for public or semi-public buses, but be careful: it's still a form of delegation. The Lambda function itself still needs IAM permission, so you have defense in depth.

For the default bus (which exists in every account), AWS manages the resource policy in a special way. By default, only entities within your own account can access the default bus. If you want to allow cross-account access to the default bus, you must explicitly add a resource policy.

A best practice is to use custom buses (not the default bus) for inter-service communication and to apply strict resource policies. The default bus should typically remain isolated, used only for AWS service events and account-internal routing.

### Encryption at Rest: Protecting Events with KMS

Events published to EventBridge are encrypted by default in transit (using TLS), but what about events stored on the bus itself—that brief window between when an event arrives and when it's routed to targets?

EventBridge supports encryption at rest using AWS Key Management Service (KMS). When you create a custom bus, you can specify a KMS key to encrypt the events stored on that bus. All events published to that bus are encrypted with the specified key before being stored.

Here's how you'd create an encrypted bus using the AWS CLI:

```bash
aws events create-event-bus \
  --name encrypted-bus \
  --kms-key-arn arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

Once a bus is created with encryption, every event published to it is automatically encrypted. The encryption happens transparently—your application code doesn't change, but the protection is there.

Using KMS encryption requires that the principal publishing events to the bus has permission to use the key. Specifically, they need the `kms:Decrypt` and `kms:GenerateDataKey` permissions on the key. This is where least privilege gets nuanced: not only must your Lambda function have `events:PutEvents` permission, but it also must have KMS permissions.

Here's a complete policy for a function that publishes to an encrypted bus:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "events:PutEvents",
      "Resource": "arn:aws:events:us-east-1:123456789012:event-bus/encrypted-bus"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:GenerateDataKey"
      ],
      "Resource": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
    }
  ]
}
```

Without the KMS permissions, the `PutEvents` call fails, even though the role has explicit EventBridge permissions. This is a common gotcha in production—developers add encryption to a bus without updating the IAM policies of the applications publishing to it, and then events silently fail to be published.

One more consideration: KMS key access is also controlled by the key's resource policy. If you're using a key from another account, you need to ensure that both the key policy (in the key's account) and the consumer's IAM policy (in their account) grant permission. This layered approach prevents unauthorized access.

For sensitive workloads—those handling payment data, personally identifiable information (PII), or healthcare records—encrypted buses are non-negotiable. They provide compliance benefits and protect against data exfiltration if your AWS environment is compromised.

### Controlling Data Exposure: Input Transformers and Target Security

IAM and encryption protect the infrastructure, but there's a subtler security concern: what data are you actually sending to your targets, and who can see it?

Consider a common scenario: an order processing system publishes an event containing order details, including the customer's credit card number (which shouldn't be there, but let's say it is due to legacy code). Multiple targets subscribe to order events: a fulfillment service, a notification service, and an analytics pipeline. All three shouldn't need to see the credit card number, but if it's in the event, all three can access it.

Input transformers solve this problem by filtering and reshaping events before they're delivered to targets. Instead of sending the raw event to all targets, you can transform it per target, removing sensitive fields.

Here's an example using the AWS CLI. Suppose your event looks like this:

```json
{
  "orderId": "12345",
  "customerId": "cust-789",
  "amount": 99.99,
  "creditCard": "4111-1111-1111-1111"
}
```

You might add a rule targeting the fulfillment service with an input transformer:

```bash
aws events put-targets \
  --rule my-order-rule \
  --event-bus-name my-bus \
  --targets "Id"="1","Arn"="arn:aws:lambda:us-east-1:123456789012:function:fulfillment","InputTransformer"="{"InputPathsMap":{"order":"$.orderId","customer":"$.customerId","amount":"$.amount"},"InputTemplate":"\"OrderId: <order>, CustomerId: <customer>, Amount: <amount>\""}"
```

This transformer extracts only the order ID, customer ID, and amount, completely stripping out the credit card number. The fulfillment Lambda receives a cleaner, safer payload.

Input transformers serve dual purposes: they improve security by limiting data exposure, and they reduce payload size, which can improve performance and reduce costs (Lambda billing includes event size). They're a powerful tool for enforcing data minimization—a principle stating that systems should only access the data they need.

Beyond input transformers, consider the IAM roles attached to targets. If a Lambda function is a target for an EventBridge rule, it executes with the permissions of its execution role. That role should only have permissions to do what the function needs. If the function's role has excessive permissions (like S3 read/write access to all buckets), and an attacker compromises the Lambda, they gain all those permissions. EventBridge doesn't directly control this, but it's part of the end-to-end security picture.

### Cross-Account Event Publishing: Advanced Security Patterns

Cross-account event publishing is common in distributed architectures, and it requires careful orchestration of IAM and resource policies.

Suppose Account A (the event producer) needs to send events to Account B (the event consumer). Here's the security setup:

In Account A, the publisher needs IAM permission to call `events:PutEvents`:

```json
{
  "Effect": "Allow",
  "Action": "events:PutEvents",
  "Resource": "arn:aws:events:us-east-1:999999999999:event-bus/consumer-bus"
}
```

In Account B, the bus must have a resource policy allowing Account A:

```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111111111111:root"
  },
  "Action": "events:PutEvents",
  "Resource": "arn:aws:events:us-east-1:999999999999:event-bus/consumer-bus"
}
```

Both pieces are necessary. Neither alone is sufficient. This is defense in depth—if one policy is misconfigured, the other blocks unauthorized access.

A best practice for cross-account scenarios is to be specific about which principals can access the bus. Instead of allowing an entire AWS account (using the account's root principal), restrict to specific roles:

```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111111111111:role/EventPublisher"
  },
  "Action": "events:PutEvents",
  "Resource": "arn:aws:events:us-east-1:999999999999:event-bus/consumer-bus"
}
```

This limits the blast radius. If a role in Account A is compromised, the attacker can only publish to buses Account B has explicitly granted that role access to.

Similarly, consider using condition keys in resource policies to further restrict access. For example, you might allow `PutEvents` only from a specific IP range or only when called with a certain principal tag:

```json
{
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111111111111:root"
  },
  "Action": "events:PutEvents",
  "Resource": "arn:aws:events:us-east-1:999999999999:event-bus/consumer-bus",
  "Condition": {
    "StringEquals": {
      "aws:PrincipalTag/Environment": "production"
    }
  }
}
```

This policy allows PutEvents only if the principal has a tag `Environment=production`, adding another layer of control.

### Least Privilege in Event-Driven Systems: Practical Design

Applying least privilege to EventBridge requires thinking about your event architecture holistically. Here are the key principles:

**Separate buses for different purposes.** Instead of using one bus for all events, create separate buses for order events, user events, notification events, and so on. This way, a role that needs to publish order events doesn't get broad access to everything. You manage permissions per bus, not per application.

**Use custom buses instead of the default bus.** The default bus is convenient for quick prototypes, but it's a shared resource. In production systems with multiple teams and services, custom buses provide clear boundaries and easier auditing.

**Scope IAM permissions to specific actions and resources.** Don't grant `events:*` on `Resource: *`. Instead, grant only the actions a service needs (e.g., `PutEvents` for publishers, `PutRule` and `PutTargets` for administrators) on specific buses and rules.

**Validate event schemas.** Use EventBridge's schema validation feature (via EventBridge Schema Registry) to ensure events conform to expected structures. This prevents malformed or unexpected data from entering your system and reduces the attack surface.

**Use input transformers liberally.** Every target should receive only the data it needs. Input transformers are not just a performance optimization; they're a security control.

**Encrypt sensitive buses.** If a bus carries any sensitive data—customer information, payment details, health records—encrypt it with KMS. The performance overhead is minimal, and the security benefit is substantial.

**Audit and monitor.** Use AWS CloudTrail to log all EventBridge API calls, including PutEvents, PutRule, and resource policy changes. Set up CloudWatch alarms for unusual activity. Regularly review bus configurations and resource policies for drift.

**Test your policies.** It's easy to make mistakes with IAM. Use the IAM Policy Simulator to test that your policies work as intended before deploying to production. Try both positive tests (confirming allowed actions work) and negative tests (confirming denied actions fail).

### Encryption in Transit and Event Confidentiality

While we've focused on encryption at rest, it's worth noting that EventBridge encrypts events in transit using TLS. When your application publishes an event via HTTPS, the data is encrypted as it travels to AWS, and AWS encrypts it again when storing it on the bus (if using KMS).

However, TLS encryption in transit only protects data between your application and AWS. Once inside AWS, the event is visible to any target that receives it. This is where input transformers and IAM roles on targets come in. Encryption at rest doesn't prevent authorized services from seeing the data—it only protects against unauthorized physical access to AWS storage infrastructure.

For end-to-end confidentiality (where even AWS can't read your data without your key), some applications apply application-level encryption to sensitive fields before publishing the event. The event itself is encrypted with KMS, and additionally, sensitive fields are encrypted with the application's own key. This adds complexity but provides maximum confidentiality.

In practice, KMS encryption at rest is sufficient for most workloads. The combination of IAM, resource policies, KMS encryption, and careful input transformation creates a robust security posture.

### Common Security Mistakes and How to Avoid Them

**Mistake 1: Relying only on IAM, forgetting resource policies.** You add an IAM policy allowing your Lambda to publish events, but you forget to add a resource policy to the bus. If someone creates a new bus with the same name in a different region, your Lambda might accidentally publish to the wrong bus, or the call might fail. Always configure both.

**Mistake 2: Sending sensitive data without input transformers.** A database connection string, API key, or customer email gets included in an event, and now multiple targets have access to it. Use input transformers to strip out data targets shouldn't see.

**Mistake 3: Over-permissive resource policies.** A resource policy that allows `"Principal": "*"` is extremely dangerous. It means anyone with an AWS account could potentially publish to your bus if your account is accessible to them. Be specific about which principals are allowed.

**Mistake 4: Not updating IAM policies when enabling KMS.** A bus gets encrypted with KMS, but the publisher's IAM policy wasn't updated to grant KMS permissions. The PutEvents call fails silently (or with a KMS error), and events stop flowing. Test this scenario before going to production.

**Mistake 5: Assuming encryption is enough.** Encryption is important, but it's not a substitute for access control. Even encrypted data should be restricted to authorized targets only. Use IAM and resource policies as the primary gates, encryption as an additional layer.

**Mistake 6: Forgetting about the default bus.** The default bus is easy to use but easy to misconfigure. A rule might inadvertently catch events meant for a specific custom bus, or cross-account access might be accidentally enabled. Be intentional about whether you use the default bus.

### Conclusion

Securing EventBridge is about layering controls: IAM permissions determine who can perform actions, resource policies gate access to specific buses, KMS encryption protects events at rest, and input transformers prevent sensitive data from reaching unintended targets. None of these alone is sufficient; together, they create a robust security posture.

The principle of least privilege is your north star. Grant only the permissions and access that are absolutely necessary. Use separate buses for different purposes. Encrypt sensitive data. Audit your configuration regularly. When you review an EventBridge architecture, ask yourself: what is the minimum set of permissions each service needs, and are we applying all available controls?

As you work with EventBridge, whether in production deployments or preparing for technical assessments, keep this layered approach in mind. Security isn't a bolt-on feature or an afterthought—it's built into the foundation of event-driven systems that can scale safely and handle the data responsibly.
