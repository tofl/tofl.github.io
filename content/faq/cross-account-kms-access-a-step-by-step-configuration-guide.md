---
title: "Cross-Account KMS Access: A Step-by-Step Configuration Guide"
---

## Cross-Account KMS Access: A Step-by-Step Configuration Guide

Imagine this scenario: your organization has a data pipeline running in one AWS account that needs to decrypt sensitive information encrypted with a KMS key in another account. Perhaps you're sharing encrypted S3 objects between teams, restoring an RDS snapshot across accounts, or enabling a third-party service to access your encrypted data. Without proper KMS access configuration, you'll hit frustrating AccessDenied errors that seem to come out of nowhere, even when your IAM policies look correct.

This is where cross-account KMS access becomes essential. Unlike most AWS permissions that flow purely through IAM policies, KMS requires a dual-authentication model: the KMS key policy must grant permission, *and* the principal's IAM policy must request it. This two-layer design is intentional—it's KMS's way of ensuring that even account administrators can't accidentally grant encryption key access. But it also means that misconfiguring either layer will silently deny your requests.

In this guide, we'll walk through a complete, real-world configuration of cross-account KMS access, covering the key policy modifications, IAM policy setup, practical testing, and how to troubleshoot when things go wrong.

### Understanding the Dual-Authentication Model

Before we dive into configuration, let's establish why KMS access works differently than other AWS services. When you call most AWS APIs, the IAM service evaluates your identity-based policies and resource-based policies. If either grants access, the call succeeds. KMS flips this model: both the key policy (the resource-based policy on the KMS key itself) *and* your IAM policy must explicitly allow the action. This is called an explicit allow model for KMS, and it means a single denial anywhere blocks the operation.

Think of it like a secure facility with two checkpoints. Your ID badge (IAM policy) gets you past the first gate, but the security guard at the second gate (KMS key policy) also needs to verify your credentials. You can't proceed without passing both checks.

This design makes cross-account KMS access straightforward once you understand it: the key policy in the source account must allow the cross-account principal, and the principal's IAM policy in the destination account must allow the specific KMS actions. Without either piece, the operation fails.

### Setting Up Your Test Environment

For this walkthrough, we'll use a concrete example: Account A owns an encrypted S3 bucket and has a KMS key that encrypts objects in it. Account B needs to read and decrypt those objects. This is a common scenario in multi-team organizations, shared data lake setups, or when providing access to third-party tools.

Let's establish our AWS accounts:
- **Account A (Source):** Contains the KMS key, S3 bucket with encrypted objects, and the key policy we'll modify
- **Account B (Destination):** Contains an IAM role or user that needs decryption permissions

You'll need access to both accounts, ideally with permissions to modify KMS key policies and create IAM policies. For testing, we'll use the AWS CLI, so make sure you have it installed and configured with credentials for both accounts.

### Step 1: Identify Your KMS Key and Understand Its Current Policy

Start in Account A by identifying the KMS key you want to share. You can list your keys with:

```bash
aws kms list-keys --region us-east-1
```

Once you have the key ID or ARN, examine its current policy:

```bash
aws kms get-key-policy --key-id arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012 --policy-name default --region us-east-1
```

This returns a JSON document—the key policy. By default, most keys are managed by AWS and have a policy that grants the account root full access. The policy might look something like this:

```json
{
  "Sid": "Enable IAM policies",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::111111111111:root"
  },
  "Action": "kms:*",
  "Resource": "*"
}
```

This statement allows any principal in Account A with the right IAM policy to use the key. However, it doesn't grant access to principals in other accounts. That's what we need to add.

### Step 2: Modify the KMS Key Policy to Grant Cross-Account Access

Now you'll add a new statement to the key policy that explicitly allows the cross-account principal. The principal should be either:

- The root of Account B (if you want maximum flexibility and will control access through IAM policies in Account B)
- A specific role in Account B (if you want tighter control at the key policy level)

For this example, we'll grant access to a specific IAM role in Account B named `DataProcessingRole`. First, get the ARN of that role:

```bash
aws iam get-role --role-name DataProcessingRole --region us-east-1
```

You'll get output like:
```
"Arn": "arn:aws:iam::222222222222:role/DataProcessingRole"
```

Now, create a new version of the key policy. Save the current policy to a file:

```bash
aws kms get-key-policy --key-id arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012 --policy-name default --region us-east-1 > key-policy.json
```

Edit `key-policy.json` and add a new statement to the `Statement` array:

```json
{
  "Sid": "Allow cross-account role to use the key",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::222222222222:role/DataProcessingRole"
  },
  "Action": [
    "kms:Decrypt",
    "kms:DescribeKey",
    "kms:GenerateDataKey"
  ],
  "Resource": "*"
}
```

The actions you include depend on what the cross-account principal needs to do. For decryption of S3 objects, `kms:Decrypt` is essential. `kms:DescribeKey` allows the principal to inspect the key metadata. `kms:GenerateDataKey` is needed if the principal will encrypt new data or use the key for envelope encryption. If you're unsure, it's safe to start with all three and tighten later.

Now apply this updated policy:

```bash
aws kms put-key-policy --key-id arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012 --policy-name default --cli-input-json file://key-policy.json --region us-east-1
```

Verify the change took effect:

```bash
aws kms get-key-policy --key-id arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012 --policy-name default --region us-east-1
```

Your new statement should appear in the output. Congratulations—you've completed the first half of the configuration. The key now allows the cross-account role to attempt decryption operations.

### Step 3: Create the IAM Policy in Account B

Switch to Account B. The `DataProcessingRole` exists, but it likely has no permissions yet. You need to attach an inline or managed IAM policy that grants KMS permissions on the specific key from Account A.

First, verify the role exists:

```bash
aws iam get-role --role-name DataProcessingRole --region us-east-1
```

Now, create an inline policy. This policy will grant specific KMS actions on the key in Account A. Create a file named `kms-cross-account-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowDecryptionOfAccountAKey",
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt",
        "kms:DescribeKey",
        "kms:GenerateDataKey"
      ],
      "Resource": "arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012"
    }
  ]
}
```

Notice that the `Resource` is the full ARN of the key in Account A, not just `*`. This restricts the policy to only that key, following the principle of least privilege.

Attach this policy to the role:

```bash
aws iam put-role-policy --role-name DataProcessingRole --policy-name AllowCrossAccountKMS --policy-document file://kms-cross-account-policy.json --region us-east-1
```

Verify the attachment:

```bash
aws iam get-role-policy --role-name DataProcessingRole --policy-name AllowCrossAccountKMS --region us-east-1
```

You now have both pieces in place: the key policy allows the role, and the role's IAM policy grants KMS actions. The cross-account access is configured.

### Step 4: Test the Configuration

Testing is where you confirm everything works and catch any misconfigurations before they cause problems in production. Start by assuming the `DataProcessingRole` in Account B so you can test as that principal.

If you're testing manually, you might create temporary credentials. For automation or testing in a CI/CD pipeline, you'd use the role directly. For this guide, let's use the CLI to assume the role:

```bash
aws sts assume-role --role-arn arn:aws:iam::222222222222:role/DataProcessingRole --role-session-name test-session --region us-east-1
```

This returns temporary credentials. Export them:

```bash
export AWS_ACCESS_KEY_ID=<AccessKeyId>
export AWS_SECRET_ACCESS_KEY=<SecretAccessKey>
export AWS_SESSION_TOKEN=<SessionToken>
```

Now test the simplest operation: describing the key in Account A. This confirms basic cross-account access:

```bash
aws kms describe-key --key-id arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012 --region us-east-1
```

If you see key metadata returned, the basic permission works. Next, test decryption. First, you need an encrypted object from Account A's S3 bucket. If you don't have one, create a simple test by uploading an encrypted object from Account A:

From Account A, with the key configured on your S3 bucket:

```bash
aws s3 cp test-file.txt s3://account-a-bucket/test-file.txt --sse aws:kms --sse-kms-key-id arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012 --region us-east-1
```

Now, from Account B (with the assumed role credentials), attempt to get and decrypt the object:

```bash
aws s3 cp s3://account-a-bucket/test-file.txt downloaded-file.txt --region us-east-1
```

If this succeeds, congratulations—your cross-account KMS access is working. S3 automatically decrypts the object using the KMS key, and since the role has permission at both the key policy and IAM policy levels, the decryption succeeds.

For more explicit testing, you can call the KMS Decrypt operation directly if you have a ciphertext blob. Export a data key from Account A:

```bash
# In Account A
aws kms generate-data-key --key-id arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012 --key-spec AES_256 --region us-east-1
```

This returns a plaintext data key and an encrypted (ciphertext) data key. Save the ciphertext. Now try to decrypt it from Account B:

```bash
# In Account B with assumed role
aws kms decrypt --ciphertext-blob fileb://ciphertext.bin --region us-east-1
```

Success means the configuration is complete. Failure indicates a misconfiguration in either the key policy or IAM policy.

### Troubleshooting Common AccessDenied Errors

Even with careful configuration, things sometimes go wrong. Here are the most common issues and how to diagnose them.

**Missing KMS action in the key policy:** If you get an AccessDenied error when testing, the first suspect is the key policy. Check that it includes the principal (the role ARN from Account B) and that the actions list includes what you're trying to do. Re-run `aws kms get-key-policy` and search for the role's ARN. If it's not there, or if the action you're performing isn't in the action list, update the policy.

**Typo in the principal ARN:** A common mistake is a typo in the ARN. The ARN must exactly match the role's actual ARN. Use `aws iam get-role --role-name DataProcessingRole` to get the precise ARN, and copy it directly into the key policy rather than typing it.

**Missing IAM policy in Account B:** If the key policy looks correct but you still get AccessDenied, check the IAM policy in Account B. Run `aws iam get-role-policy --role-name DataProcessingRole --policy-name <policy-name>` and verify it grants the action you're attempting on the correct key ARN. If the action is missing or the resource doesn't match, update the policy.

**Resource mismatch in IAM policy:** A subtle issue occurs when the IAM policy's Resource field uses a key ID instead of the ARN, or uses a different region. KMS requires the full ARN. Ensure the policy specifies `arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012` (with your actual key ID, region, and account).

**Assuming the wrong role:** When testing, ensure you've assumed the correct role in the correct account. If you intend to test as `DataProcessingRole` in Account B but accidentally assume a role in Account A, the test will succeed for the wrong reason. Check your environment variables and credentials.

**Region mismatch:** KMS keys are regional. If your key is in `us-east-1` but you're calling KMS APIs in `us-west-2`, you'll get a key-not-found error, not an AccessDenied. Always specify the correct region in your AWS CLI calls.

**Key policy overwrites:** If you're using CloudFormation or other infrastructure-as-code tools to manage the key, be aware that creating or updating the key may overwrite the key policy you manually edited. Document the policy statements you need, and ensure they're included in your IaC templates to avoid losing them during updates.

To debug, enable CloudTrail logging in both accounts and examine the events. When a KMS operation fails, CloudTrail records the error reason. Access the CloudTrail console, find the failed KMS API call, and check the `errorCode` and `errorMessage` fields. They often point directly to the problem.

### Real-World Use Cases and Variations

Cross-account KMS access appears in several scenarios beyond the basic example we've covered.

**Sharing encrypted S3 objects:** This is the most common use case. Account A stores sensitive data in S3, encrypted with its own KMS key. Account B (perhaps a data science team or partner organization) needs to read and analyze the data. Configure the key policy and S3 bucket policy to allow Account B's role, and ensure the role has `s3:GetObject` and KMS decrypt permissions. S3 will use the KMS key transparently during the GetObject call.

**Cross-account RDS snapshot sharing:** When you create an RDS snapshot encrypted with a KMS key, sharing it to another account requires that account's principals to have decrypt permission on the key. The RDS snapshot sharing mechanism handles the S3 bucket operations automatically, but KMS access is still needed. Add the cross-account principal to the key policy with `kms:Decrypt` and `kms:CreateGrant` actions, then share the snapshot from Account A's RDS console.

**Data replication across accounts:** Services like DMS (Database Migration Service) or DataSync replicate data across accounts. If the source is encrypted, grant the service role in the destination account KMS permissions. The service will call KMS to decrypt source data and, if needed, re-encrypt for the destination.

**Centralized key management with delegated access:** Some organizations run a central account that owns all KMS keys and grants cross-account access to team accounts. This centralizes key rotation, auditing, and compliance. The key policies in the central account explicitly list each team account's principals, and each team account's IAM policies reference the central key ARNs.

In each scenario, the principle remains the same: both the key policy and the IAM policy must allow the operation.

### Best Practices for Cross-Account KMS Access

As you implement cross-account KMS access, follow these practices to keep your security posture strong and your configuration maintainable.

**Use specific principals in the key policy, not just the account root.** Instead of granting `arn:aws:iam::222222222222:root` access, specify the exact role like `arn:aws:iam::222222222222:role/DataProcessingRole`. This limits blast radius if a role is compromised.

**Restrict actions to the minimum needed.** If an application only decrypts data and never encrypts, don't grant `kms:GenerateDataKey` or `kms:Encrypt`. Use the least privilege principle.

**Use condition keys in the key policy for additional control.** KMS key policies support condition keys like `kms:ViaService` to restrict usage to specific AWS services. For example:

```json
{
  "Sid": "Allow cross-account S3 decryption only",
  "Effect": "Allow",
  "Principal": {
    "AWS": "arn:aws:iam::222222222222:role/DataProcessingRole"
  },
  "Action": "kms:Decrypt",
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "kms:ViaService": "s3.us-east-1.amazonaws.com"
    }
  }
}
```

This restricts the role to using the key only when called through S3, preventing its use in other contexts.

**Document your key policies and IAM policies.** Add descriptive Sids (statement IDs) so future maintainers understand why each statement exists. Use comments in CloudFormation or Terraform templates.

**Audit cross-account access regularly.** Review key policies quarterly to ensure outdated cross-account access is removed. Use AWS Config or other compliance tools to flag keys with unusual cross-account permissions.

**Test cross-account access in a non-production environment first.** Before enabling cross-account access to keys protecting production data, validate the configuration in a dev or staging environment.

**Consider using KMS grants for temporary cross-account access.** If access is temporary (e.g., for a one-time data export), use KMS grants instead of modifying the key policy. Grants are easier to revoke and don't require key policy changes. From Account A:

```bash
aws kms create-grant --key-id arn:aws:kms:us-east-1:111111111111:key/12345678-1234-1234-1234-123456789012 --grantee-principal arn:aws:iam::222222222222:role/DataProcessingRole --operations Decrypt DescribeKey --region us-east-1
```

The grant returns a grant token that can be used in subsequent KMS calls, and it can be retired (revoked) easily.

### Conclusion

Cross-account KMS access, while initially complex, becomes straightforward once you understand the dual-authentication model. Success requires modification of the KMS key policy in the source account to allow the cross-account principal, and creation of an IAM policy in the destination account that grants the necessary KMS actions.

The configuration process is methodical: identify your key, add a statement to its policy granting the cross-account principal specific actions, create an IAM policy in the destination account referencing the source key's ARN, and test the configuration. When troubleshooting, remember that either piece—key policy or IAM policy—can cause failures, so verify both.

By following the practices outlined in this guide and staying mindful of least privilege, you can safely and securely enable cross-account data sharing while maintaining strong control over your encryption keys. Whether you're sharing S3 objects, RDS snapshots, or enabling third-party services, this foundation will serve as your reference for implementing KMS access across account boundaries.
