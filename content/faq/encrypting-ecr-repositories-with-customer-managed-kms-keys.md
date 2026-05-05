---
title: "Encrypting ECR Repositories with Customer-Managed KMS Keys"
---

## Encrypting ECR Repositories with Customer-Managed KMS Keys

When you push your first Docker image to Amazon Elastic Container Registry (ECR), you might not give much thought to how that image data is encrypted at rest. By default, AWS handles the encryption transparently using AES-256, and for many workloads, that's perfectly adequate. But if you're operating in a regulated industry, managing sensitive applications, or need direct control over encryption keys, you'll want to understand how to use customer-managed AWS Key Management Service (KMS) keys to encrypt your ECR repositories. This capability becomes essential when compliance frameworks demand that you—not AWS—hold the encryption keys.

The journey toward customer-managed encryption in ECR reveals some important architectural decisions and constraints that will shape how you design your container infrastructure. Unlike some AWS services that let you switch encryption settings on the fly, ECR encryption is a one-time decision made at repository creation. Understanding why this limitation exists, how to configure it correctly, and what permissions your KMS keys need will help you build a more secure and auditable container pipeline.

### Why Encryption Matters in Container Registries

Container images are essentially application bundles—they contain your compiled code, dependencies, configuration templates, and sometimes sensitive data baked directly into layers. Even though images are typically immutable once built, they're valuable intellectual property and potential security targets. An attacker who gains access to your image registry could steal your application logic, extract embedded secrets, or inject malicious code that gets deployed across your infrastructure.

By default, ECR stores images encrypted with AES-256 using AWS-managed keys. This is what's called server-side encryption, and it protects your images from unauthorized access to the underlying storage infrastructure. However, AWS-managed keys come with an important limitation: AWS manages the key lifecycle, rotation, and access policies. You cannot revoke access to these keys or audit their usage in the same way you can with keys you manage yourself.

In environments where compliance regulations like HIPAA, PCI-DSS, or your organization's own security policies require explicit key ownership and control, a customer-managed KMS key becomes necessary. With a CMK (customer master key, or in modern KMS terminology, a customer-managed key), you define exactly who can use the key, you can audit every encryption and decryption operation through CloudTrail, and you can rotate or disable the key on your own schedule.

### AES-256 Versus Customer-Managed KMS Encryption

The default encryption mechanism in ECR uses AES-256, which is a symmetric encryption algorithm offering 256-bit key strength. This is genuinely strong encryption—there's no cryptographic weakness here. The difference between AES-256 and KMS-based encryption isn't about the strength of the cipher itself, but rather about key management and control.

When you use AWS-managed keys (the default), AWS creates and rotates those keys according to its own practices. You can see that encryption is happening, and you can enable CloudTrail logging to see that encrypted objects exist, but you have limited visibility into key usage and no ability to revoke access retroactively. Think of it like having a security guard managed by the building: competent and trustworthy, but not directly under your command.

With customer-managed KMS keys, you explicitly create a key in AWS KMS, define its permissions, manage its rotation policy, and can immediately disable or schedule key deletion if needed. You also get granular audit trails showing exactly which principals used the key, when they used it, and what operations they performed. This level of control is what compliance frameworks typically require. If an employee leaves or a service account is compromised, you can immediately revoke key access without waiting for key rotation cycles.

It's worth noting that under the hood, ECR still uses symmetric encryption—KMS just wraps and manages the actual data encryption keys. When you encrypt an image with a customer-managed KMS key, ECR generates a unique data key for each image, encrypts that data key with your KMS key, and stores both together. When you later pull the image, ECR uses your KMS key to decrypt the data key, then uses that to decrypt the image. This envelope encryption pattern is standard practice and adds minimal latency to encryption and decryption operations.

### The One-Time Creation Constraint

Here's a critical architectural constraint that often surprises developers: you cannot change the encryption settings of an ECR repository after it's created. If you initially create a repository with the default AES-256 encryption and later decide you need a customer-managed KMS key, you cannot simply flip a setting. Instead, you must create a new repository with the desired encryption configuration, migrate your images to the new repository, update all references to point to the new repository, and delete the old one.

This limitation exists because changing the encryption key would require re-encrypting potentially massive image layers. A production image can easily be hundreds of megabytes or even gigabytes. Allowing runtime encryption changes would introduce operational complexity and potential data corruption risks. By making encryption a creation-time decision, AWS ensures that the encryption parameters are immutable for the repository's lifetime, which is actually a good design principle for consistency and auditability.

The practical implication is that you should determine your encryption requirements early in your container infrastructure planning. If you're building a new system and you know your organization requires customer-managed keys, create repositories with that configuration from the start. If you're retrofitting encryption onto existing repositories, plan the migration carefully, including how to update CI/CD pipelines and deployment configurations.

Creating an ECR repository with a customer-managed KMS key using the AWS CLI looks like this:

```bash
aws ecr create-repository \
  --repository-name my-app \
  --encryption-configuration encryptionType=KMS,kmsKey=arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

Alternatively, using the AWS Management Console, you'd navigate to ECR, create a repository, and in the encryption configuration section, select "Customer-managed key" and choose your KMS key from the dropdown.

### Configuring KMS Key Policies for ECR Access

Once you've created a KMS key that you want to use with ECR, you need to ensure that the key policy allows ECR to use it. This is where many developers stumble. You can create a perfect repository configuration and a perfectly valid KMS key, but if the key policy doesn't grant ECR the necessary permissions, pushes and pulls will fail with cryptic encryption-related errors.

The KMS key policy is a JSON document that defines who can perform which operations on the key. By default, when you create a new customer-managed key, only the key creator and AWS account root have permissions. ECR needs specific permissions to encrypt and decrypt images.

At minimum, the KMS key policy must grant the ECR service the `kms:Decrypt`, `kms:GenerateDataKey`, and `kms:DescribeKey` actions. Here's an example of a policy statement you'd add to your key policy:

```json
{
  "Sid": "Allow ECR to use the key",
  "Effect": "Allow",
  "Principal": {
    "Service": "ecr.amazonaws.com"
  },
  "Action": [
    "kms:Decrypt",
    "kms:GenerateDataKey",
    "kms:DescribeKey"
  ],
  "Resource": "*"
}
```

However, this is the service-level permission. You also need to ensure that the IAM principals (users, roles) that will be pushing and pulling images have permissions to use the KMS key. If you're using an IAM role for your CI/CD system or your ECS task execution role, those principals also need KMS permissions. This is a common source of confusion: you might grant ECR API permissions to push to a repository, but if the associated IAM role can't use the KMS key, the push will fail at the encryption step.

A complete set of permissions for an IAM principal pushing images might look like this:

```json
{
  "Effect": "Allow",
  "Action": [
    "ecr:GetDownloadUrlForLayer",
    "ecr:BatchGetImage",
    "ecr:PutImage",
    "ecr:InitiateLayerUpload",
    "ecr:UploadLayerPart",
    "ecr:CompleteLayerUpload"
  ],
  "Resource": "arn:aws:ecr:us-east-1:123456789012:repository/my-app"
},
{
  "Effect": "Allow",
  "Action": [
    "kms:Decrypt",
    "kms:GenerateDataKey",
    "kms:DescribeKey"
  ],
  "Resource": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
}
```

The second statement grants the necessary KMS permissions. Without it, even with valid ECR permissions, operations will fail. When testing your setup, always check both the ECR repository policy and the KMS key policy. A helpful debugging approach is to attempt a push from your CI/CD environment and examine the CloudTrail logs; KMS will log permission denial events with clear details about what permissions were missing.

### Cross-Account Encryption Scenarios

If you're operating in a multi-account AWS environment—a common pattern for organizations with separate accounts for development, staging, and production—encryption with customer-managed KMS keys introduces additional complexity.

Suppose you have a central image repository in your production account that's encrypted with a KMS key in that account. Your CI/CD system might run in a different account, and your ECS clusters that consume the images might run in yet other accounts. Each of these needs to decrypt the images, which means each account's principals need access to the KMS key in the production account.

Granting cross-account access to a KMS key requires coordination between key policies and IAM roles. The KMS key policy in the production account must explicitly grant the cross-account principal permission to use the key:

```json
{
  "Sid": "Allow cross-account CI/CD to use key",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111111111111:role/cicd-role"
  },
  "Action": [
    "kms:Decrypt",
    "kms:GenerateDataKey",
    "kms:DescribeKey"
  ],
  "Resource": "*"
}
```

And the cross-account IAM role in the development account must have an inline or attached policy that includes the same KMS permissions:

```json
{
  "Effect": "Allow",
  "Action": [
    "kms:Decrypt",
    "kms:GenerateDataKey",
    "kms:DescribeKey"
  ],
  "Resource": "arn:aws:kms:us-east-1:999999999999:key/12345678-1234-1234-1234-123456789012"
}
```

This two-way permission grant—one in the key policy allowing the cross-account principal, and one in the cross-account IAM policy allowing use of the key—is essential. If either is missing, the cross-account access will fail.

In practice, many organizations use a dedicated KMS key for image encryption and centralize it in a security or platform engineering account. All other accounts then request access to this key. This centralizes key governance but requires careful planning around key policy updates and rotation.

### Integration with Compliance and Audit Requirements

Customer-managed KMS encryption becomes especially valuable when you need to satisfy compliance auditing requirements. When you enable CloudTrail in your AWS account (which most regulated environments do), all KMS operations are logged, including encryption and decryption events on your ECR images.

Each time someone pulls an image from an encrypted ECR repository, that decryption operation generates a CloudTrail event. You can query these logs to answer questions like "Who accessed this image and when?" or "Has this sensitive image been pulled in the last 30 days?" These audit trails are invaluable for compliance reviews and security investigations.

Furthermore, because you control the key lifecycle, you can implement key rotation policies that satisfy specific compliance requirements. KMS supports automatic annual key rotation, or you can manually rotate keys as needed. You can also schedule key deletion, which provides a grace period before permanent deletion—useful if you later realize a key deletion was accidental.

For certain compliance scenarios, you might even want to use AWS CloudHSM, which provides customer-managed hardware security modules for key storage. Images encrypted with CMK-backed HSM keys have an additional security boundary, as the actual key material exists in dedicated hardware that you can audit and control at a physical level.

### Practical Implementation Considerations

When implementing customer-managed encryption for ECR repositories, think through a few practical points. First, consider key naming conventions. A KMS key is identified by its key ID or key ARN. Many organizations create multiple keys across regions and accounts, so clear naming policies help prevent accidental use of wrong keys. Key aliases, which are friendly names you assign to keys, can make configuration more readable. For example, instead of referencing a 36-character key ID in your repository configuration, you could use `alias/ecr-prod-encryption`.

Second, plan your key access model. Will each team have their own KMS key, or will you share a centralized key across multiple repositories? Centralization simplifies management but concentrates access control. Per-team keys offer stronger isolation but require more administrative overhead. There's no universally correct answer—it depends on your organization's risk tolerance and operational model.

Third, document your key rotation schedule. Even though KMS can automate rotation, someone should track when it's happening and monitor for any related issues. Rotations are generally transparent, but it's worth having a monitoring process in place.

Finally, test your setup thoroughly before depending on it for production images. Create a test repository with your KMS key, push an image, pull it from a different account or role, and verify that all operations complete successfully. Use CloudTrail to confirm that the expected KMS operations are being logged. This testing phase often surfaces permission issues that would otherwise only appear under production load.

### Weighing the Tradeoffs

Implementing customer-managed KMS encryption for ECR repositories adds operational overhead. You must manage key policies, monitor key usage, plan rotation schedules, and handle the immutability constraint that comes with encryption-at-creation. For teams just starting with containers or those in low-sensitivity environments, this overhead might not justify the benefits.

However, for organizations subject to regulatory requirements, managing sensitive workloads, or operating multi-account infrastructure where audit and compliance are critical, customer-managed encryption is not optional—it's a requirement. The ability to control key access, audit every decryption event, and quickly revoke access to image data makes it essential for security posture.

The key architectural insight is that encryption in ECR is a feature best decided early, during initial infrastructure planning. You cannot retrofit it onto existing repositories, so the earlier you determine your encryption requirements, the better. If there's any possibility that you'll need customer-managed keys down the road, start with that configuration. The minimal performance overhead of KMS-backed encryption is worth the consistency and security it provides.
