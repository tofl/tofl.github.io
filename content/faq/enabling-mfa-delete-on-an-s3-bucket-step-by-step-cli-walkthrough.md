---
title: "Enabling MFA Delete on an S3 Bucket: Step-by-Step CLI Walkthrough"
---

## Enabling MFA Delete on an S3 Bucket: Step-by-Step CLI Walkthrough

Amazon S3 is often described as the backbone of AWS storage, and for good reason—it's flexible, scalable, and affordable. But that flexibility comes with responsibility. If you've ever worried about accidental or malicious deletion of critical data in S3, you've identified exactly why MFA Delete exists. Yet despite its importance, enabling MFA Delete remains one of the more counterintuitive features in AWS, wrapped in surprising limitations and quirks that catch many developers off guard.

Unlike most S3 security features you can toggle in the console with a few clicks, MFA Delete demands a specific approach: it can only be enabled via the AWS CLI, only by the root account, and only when versioning is already enabled on your bucket. Miss any of these requirements and you'll face cryptic error messages that offer little guidance. This guide walks you through the exact steps, explains the why behind the restrictions, and arms you with practical knowledge to handle both the happy path and common stumbling blocks.

### Understanding MFA Delete and Why It Matters

Before we dive into the mechanics, let's establish why MFA Delete exists and why AWS makes it so deliberately difficult to enable. MFA Delete is a bucket-level protection mechanism that requires multi-factor authentication for two critical operations: permanently deleting object versions and suspending versioning on the bucket itself. Think of it as a kill switch that demands you prove your identity twice before allowing truly destructive actions.

The motivation is sound. In a versioned S3 bucket, deleting an object doesn't actually remove it—it creates a delete marker, leaving all previous versions intact. This gives you an audit trail and recovery capability. However, object versions can be permanently deleted, and versioning itself can be suspended. These operations are powerful tools for cleanup, but in the wrong hands or through a mistaken script, they can cause irreversible data loss at scale.

AWS made MFA Delete intentionally inconvenient to enable as a design choice. Requiring root account access and CLI-only setup forces a deliberate security decision rather than a checkbox you might tick on a Friday afternoon without thinking through the implications. It's friction by design, and it's meant to make you pause and confirm this is what you truly want.

### Prerequisites: Setting Up Your Environment

Before you attempt to enable MFA Delete, you need several pieces in place. First, versioning must already be enabled on your S3 bucket. You can verify this and enable it if needed with a simple CLI command:

```bash
aws s3api get-bucket-versioning --bucket my-bucket-name
```

If the output shows `"Status": "Enabled"`, you're good. If it returns nothing or shows `"Status": "Suspended"`, enable versioning:

```bash
aws s3api put-bucket-versioning --bucket my-bucket-name \
  --versioning-configuration Status=Enabled
```

Second, you absolutely must be using the AWS root account, not an IAM user. This is non-negotiable. Even if an IAM user has `s3:*` permissions and `sts:AssumeRole` across all resources, they cannot enable MFA Delete. This is a hardcoded AWS restriction designed to ensure only the account owner can implement this level of protection. If you're in an organization using IAM best practices (which you should be), you'll need to log into the root account—a rare and intentional event—specifically for this task.

Third, you need an MFA device registered to your root account. This is typically a virtual MFA device using an authenticator app like Google Authenticator, Authy, or Microsoft Authenticator, though hardware tokens work as well. Navigate to the AWS Management Console, go to the security credentials for your root account, and ensure an MFA device is active. You'll need the device's serial number and the ability to generate current one-time passwords (TOTPs).

Finally, configure your AWS CLI with root account credentials. This typically means creating access keys for the root account (another security operation AWS discourages but sometimes necessitates), or using temporary credentials through another method if your organization supports it. Store these credentials securely in your `~/.aws/credentials` file or use environment variables.

### Gathering the Required Information

To execute the MFA Delete command, you need two pieces of information: the MFA device's serial number and a current TOTP from that device. Let's collect these.

The MFA device serial number is an ARN that uniquely identifies your MFA device. To find it, sign into the AWS Management Console as the root account, navigate to Account > Security Credentials, and look at the MFA devices section. The serial number appears in a format like `arn:aws:iam::123456789012:mfa/root-account-mfa-device`. Write this down—you'll use it in the CLI command.

For the TOTP, open your authenticator app and look for the entry corresponding to your AWS root account's MFA device. You'll see a six-digit code that changes every 30 seconds. This is time-sensitive: you need to enter it within its validity window, which is why the command execution and TOTP generation should happen in close succession.

A practical tip: generate the TOTP just before you run your CLI command. If you generate it too early and it expires before the command executes, AWS will reject it with an authentication error. Conversely, generating it too late and then typing slowly won't help either. Ideally, generate the code when you're ready to paste it into the terminal.

### The Core Command: Putting It All Together

Now we arrive at the central operation. The command to enable MFA Delete uses `aws s3api put-bucket-versioning` with the `--mfa` parameter. Here's the structure:

```bash
aws s3api put-bucket-versioning \
  --bucket my-bucket-name \
  --versioning-configuration Status=Enabled \
  --mfa "arn:aws:iam::123456789012:mfa/root-account-mfa-device 123456"
```

Let's break this down. The `--bucket` parameter specifies the target bucket. The `--versioning-configuration Status=Enabled` ensures versioning is enabled as part of this call (it should already be enabled, but including it reinforces the state). The `--mfa` parameter takes two space-separated values: the device ARN and the current TOTP. These must be quoted together as a single string.

In practice, you might see examples using `--mfa-serial-number` and `--mfa-totp` as separate parameters in older documentation, but the modern approach uses `--mfa "SerialNumber MFACode"` as shown above. AWS CLI has evolved, and this is the current standard.

Here's a more concrete example with placeholder values replaced:

```bash
aws s3api put-bucket-versioning \
  --bucket production-data-bucket \
  --versioning-configuration Status=Enabled \
  --mfa "arn:aws:iam::987654321098:mfa/root 654321"
```

Execute this command, and if everything aligns—valid TOTP, correct device ARN, root credentials in use, versioning already enabled—you'll receive a success response with no output (which, in AWS CLI convention, means it worked). To verify that MFA Delete is now enabled, use:

```bash
aws s3api get-bucket-versioning --bucket my-bucket-name
```

This will return output including `"MFADelete": "Enabled"`, confirming the protection is active.

### What Changes When MFA Delete Is Enabled

Once MFA Delete is enabled, certain operations on the bucket are now restricted. Understanding these constraints is crucial for ongoing operations and automation.

Permanently deleting object versions requires MFA authentication. When you run `aws s3api delete-object` or `aws s3api delete-objects` to remove specific versions, you must provide the `--mfa` parameter with a current TOTP, just as you did to enable the feature. Without it, the deletion will fail. This applies to deleting individual versions or batches of them. For example:

```bash
aws s3api delete-object \
  --bucket my-bucket-name \
  --key my-object-key \
  --version-id specific-version-id \
  --mfa "arn:aws:iam::123456789012:mfa/root-account-mfa-device 123456"
```

Suspending versioning also requires MFA. If you want to stop accepting new versions of objects (moving the bucket from `Enabled` to `Suspended` state), you need MFA authentication. The command looks similar:

```bash
aws s3api put-bucket-versioning \
  --bucket my-bucket-name \
  --versioning-configuration Status=Suspended \
  --mfa "arn:aws:iam::123456789012:mfa/root-account-mfa-device 654321"
```

Note that once versioning is suspended, new uploads still work normally, but previous versions remain protected. You cannot delete or modify existing versions without MFA even after suspension.

Regular object uploads, downloads, and modifications are unaffected. IAM users can continue normal operations without MFA. Only these two specific destructive actions require re-authentication, and only the root account can perform them (without additional IAM policy complexity, anyway).

### Implications for Automation and Scripts

This is where MFA Delete gets thorny in real-world deployments. Many S3 operations are automated through scripts, Lambda functions, or infrastructure-as-code tools. If your automation previously handled object version cleanup or versioning state changes, adding MFA Delete introduces a significant operational constraint.

You cannot bake an MFA code into a script because codes expire within 30 seconds. You cannot use IAM user credentials to work around the root account requirement. You cannot disable MFA Delete through the console or programmatically as an IAM user—disabling it requires the same root account + MFA CLI process as enabling it.

This means any automated cleanup of old versions requires a different strategy. Some teams set a lifecycle policy on the bucket using `aws s3api put-bucket-lifecycle-configuration` to automatically delete old versions after a specified number of days, which does not require MFA. Others use a manual approval process where cleanup requests are reviewed and executed by someone with root account access and an MFA device on hand.

If your organization relies heavily on automated version cleanup, consider whether MFA Delete aligns with those practices. For many teams, the security benefit outweighs the operational inconvenience, especially for critical data buckets. For others, a lifecycle policy combined with strong IAM restrictions provides sufficient protection without the friction.

### Disabling MFA Delete: Process and Considerations

If you later decide to disable MFA Delete, the process mirrors enabling it but with one crucial difference: disabling requires MFA authentication as well, since suspension is considered a potentially dangerous operation.

```bash
aws s3api put-bucket-versioning \
  --bucket my-bucket-name \
  --versioning-configuration Status=Enabled \
  --mfa "arn:aws:iam::123456789012:mfa/root-account-mfa-device 123456"
```

Wait—that looks the same as enabling it. The key difference is that you're setting `Status=Enabled` even if it's already enabled. To actually disable MFA Delete, you need to use a parameter that explicitly removes it. Unfortunately, AWS S3 does not have a direct "disable MFA Delete" parameter in the CLI. Instead, disabling happens only through a more complex process or by using the AWS SDK with specific calls. In practical terms, most organizations that enable MFA Delete do so intentionally and never disable it.

If you absolutely must disable it for some reason, the most straightforward approach involves contacting AWS Support or using the S3 API through an SDK where you can explicitly set `MFADelete` to `Disabled` in the versioning configuration. This is deliberately inconvenient—another safety mechanism.

### Troubleshooting Common Errors

When enabling MFA Delete, several predictable errors surface. Let's walk through the most common ones and their solutions.

**AccessDenied or UnauthorizedOperation errors** almost always mean you're not using the root account. Double-check that your AWS CLI is configured with root account credentials, not an IAM user. You can verify this by running `aws sts get-caller-identity` and confirming the returned account ID and that there's no `"Arn"` field indicating an IAM user.

**InvalidInput or InvalidVersioningState errors** suggest that versioning is not enabled on the bucket. Run `aws s3api get-bucket-versioning --bucket my-bucket-name` to verify the status is `"Enabled"`. If not, enable it first with `put-bucket-versioning` without the `--mfa` parameter.

**InvalidMFA errors** mean the TOTP you provided was invalid, expired, or the device ARN was incorrect. Verify the device ARN matches exactly (it's long and precise), and regenerate the TOTP from your authenticator app. These codes expire within 30 seconds, so timing matters. If you're copying and pasting, ensure there are no extra spaces.

**NoSuchBucket errors** indicate the bucket name is misspelled or the credentials you're using don't have access to it. Confirm the bucket name and that your root credentials have S3 permissions (they should by default).

**ServiceUnavailable or intermittent failures** sometimes occur during the operation. Retry the command after a brief pause. These are rare but can happen during AWS service hiccups.

A helpful debugging strategy: test your credentials and device access separately before running the full command. Verify `aws sts get-caller-identity` returns the root account, and confirm your authenticator app is synced and generating codes correctly. Then execute the full command with fresh MFA credentials.

### Best Practices and Recommendations

Enabling MFA Delete is a powerful security decision, so approach it with intention. Here are some guidelines:

Enable MFA Delete primarily for production buckets containing critical or sensitive data. Personal project buckets or development buckets rarely warrant the operational overhead. If you're using S3 for data lakes, backups, compliance-regulated data, or financially sensitive information, MFA Delete strengthens your security posture significantly.

Plan your version management strategy before enabling MFA Delete. Decide how you'll handle version cleanup—through lifecycle policies, manual processes, or scheduled reviews. Document this process so future team members understand the constraints.

Use a strong MFA device and store the recovery codes safely. If your authenticator app is lost and you can't generate TOTPs, you'll be unable to delete versions or suspend versioning on protected buckets. AWS provides recovery options, but they require additional identity verification steps.

Consider the compliance and audit angle. If your organization operates under regulatory frameworks like HIPAA, PCI-DSS, or SOC 2, MFA Delete provides a logged, auditable control that demonstrates commitment to preventing unauthorized data destruction. This can be valuable during compliance reviews.

Notify your team when you enable MFA Delete on a shared bucket. The operational impact—especially if they were relying on automated cleanup—needs to be communicated and handled collaboratively.

Document the bucket's MFA status and the decision rationale in your infrastructure documentation or README files. Future team members need to understand why certain S3 buckets require root account intervention for version management.

### Conclusion

Enabling MFA Delete on an S3 bucket is a deliberate act of hardening your data security posture. The friction involved—requiring root account access, CLI-only setup, MFA authentication, and careful command syntax—exists for good reason: it ensures that permanent data destruction is never accidental and always auditable.

By working through the prerequisites, gathering the correct MFA information, executing the `put-bucket-versioning` command with the `--mfa` parameter, and understanding the operational constraints that follow, you've implemented a protection mechanism that guards against one of the most damaging failure modes in cloud storage: irreversible data loss.

The cost is operational complexity, especially for automated workflows. But for buckets holding your organization's most critical or sensitive data, that cost is often well worth the peace of mind. Armed with the knowledge from this guide—and hopefully spared from the cryptic error messages that typically greet first-time attempts—you can now enable MFA Delete with confidence and help protect your S3 buckets against both accidents and malicious actors.
