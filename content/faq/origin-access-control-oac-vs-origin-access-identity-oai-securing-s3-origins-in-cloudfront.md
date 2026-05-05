---
title: "Origin Access Control (OAC) vs Origin Access Identity (OAI): Securing S3 Origins in CloudFront"
---

## Origin Access Control (OAC) vs Origin Access Identity (OAI): Securing S3 Origins in CloudFront

When you serve content from an Amazon S3 bucket through CloudFront, you face a fundamental security question: how do you ensure that users can only access your files through the CDN, not by going directly to S3? For years, developers relied on Origin Access Identity (OAI) to solve this problem. Today, AWS has introduced Origin Access Control (OAC), a more powerful and flexible solution that addresses limitations OAI could never overcome. Understanding the shift from OAI to OAC is essential for building secure, modern AWS architectures—and it's a topic you'll encounter when working with content distribution and access control.

In this article, we'll explore what OAI and OAC are, why AWS moved away from OAI, the concrete technical advantages OAC brings to the table, and most importantly, how to migrate your existing CloudFront distributions to use OAC. We'll also walk through the precise bucket policies, KMS considerations, and debugging steps you'll need to implement and troubleshoot in production.

### Understanding the Problem: Why Control S3 Access at All?

Before diving into OAI and OAC, let's establish why you need either one. When you configure CloudFront to pull content from an S3 origin, CloudFront acts as a caching layer between your users and your S3 bucket. Without any restrictions, both CloudFront and direct S3 requests would work fine—but that's a security risk. A determined user could bypass CloudFront entirely by making HTTP requests directly to your S3 bucket's public endpoint, circumventing your caching strategy, WAF rules, logging, and monitoring that CloudFront provides.

The solution is to make your S3 bucket private—blocking all public access—while simultaneously allowing CloudFront's servers to read from it. OAI and OAC are two mechanisms for establishing this trust relationship.

### Origin Access Identity (OAI): The Legacy Approach

Origin Access Identity has been AWS's standard solution since 2009. Here's how it works conceptually: you create a special AWS identity (an OAI) and associate it with your CloudFront distribution. When CloudFront needs to fetch objects from S3, it uses this OAI identity. You then grant the OAI permission to read from your S3 bucket via a bucket policy. The result is that CloudFront can access the bucket, but regular AWS users and anonymous internet users cannot.

To set up OAI, you'd create the identity through the CloudFront console or API, then attach an S3 bucket policy allowing that identity to perform `s3:GetObject` and `s3:ListBucket` actions. The identity itself is represented internally as an AWS account-like entity with a unique canonical user ID.

**Why OAI Works for Basic Scenarios**

OAI was perfectly adequate for straightforward content distribution—static websites, public media files, and other use cases where you just needed to prevent direct S3 access. Many organizations still run OAI in production today without issues, and if your architecture doesn't require the advanced features OAC provides, migration isn't strictly necessary (though AWS strongly recommends it).

**The Limitations That Led to OAC**

However, OAI has three significant constraints that become painful in real-world scenarios:

First, OAI cannot sign requests with AWS Signature Version 4 (SigV4). This matters because SigV4 is required when your S3 bucket uses server-side encryption with AWS KMS (SSE-KMS). If you have a compliance requirement to encrypt objects with customer-managed KMS keys, OAI simply won't work—your CloudFront distribution will fail to retrieve objects, returning access denied errors despite correct bucket policies.

Second, OAI doesn't support all S3 regions equally. While OAI works in most AWS Regions, it has never been available in every S3 region globally. This limits your flexibility if you're architecting multi-region solutions or need to store data in less common geographic regions.

Third, the identity model feels somewhat opaque. Managing permissions through a canonical user ID is less intuitive than explicitly specifying the service and distribution making the request. There's no built-in way to scope an OAI to a specific CloudFront distribution at the bucket policy level—you grant it blanket access if you grant it any.

### Origin Access Control (OAC): The Modern Solution

Origin Access Control addresses every limitation of OAI. Introduced by AWS in 2022, OAC uses a fundamentally different authentication mechanism based on the AWS Security Token Service (STS) and request signing.

**How OAC Actually Works**

When you create an OAC and associate it with a CloudFront distribution, CloudFront automatically signs all requests to your S3 origin using AWS Signature Version 4. This is crucial: instead of relying on a static identity, OAC uses time-limited, cryptographically signed requests. Each request includes the distribution's credentials and a signature proving the request came from CloudFront.

At the S3 side, you craft a bucket policy that validates these signatures by checking specific conditions: the `aws:SourceArn` condition ensures requests are coming from your specific CloudFront distribution's origin, and the signature itself proves those requests haven't been tampered with.

**The Three Technical Advantages**

The first advantage is SigV4 support and, by extension, SSE-KMS compatibility. Because OAC signs requests with SigV4, your S3 bucket can use server-side encryption with customer-managed KMS keys. CloudFront will successfully decrypt and serve encrypted objects. This is mission-critical for regulated industries requiring encryption with specific key management practices.

The second advantage is broader regional availability. OAC works in all AWS Regions where S3 exists, giving you true global flexibility for multi-region deployments.

The third advantage is explicitness and auditability. By specifying the CloudFront distribution's origin ARN in the bucket policy, you're being crystal-clear about exactly which distribution can access which bucket. This is far more secure and easier to audit than the implicit trust model of OAI.

### Setting Up OAC: Step-by-Step Implementation

Let's walk through creating an OAC and configuring your S3 bucket to trust it.

**Step 1: Create the OAC in CloudFront**

In the AWS CloudFront console, navigate to the Origins access menu and select "Create origin access control." You'll be prompted to give it a name—something descriptive like `my-app-oac` or `static-content-oac`. Select the signing behavior as "Sign requests (recommended)" and the origin type as "S3." AWS will automatically assign a unique ID to this OAC.

Alternatively, you can create it via the AWS CLI:

```bash
aws cloudfront create-origin-access-control \
  --origin-access-control-config \
    Name=my-app-oac,\
    SigningBehavior=always,\
    SigningProtocol=sigv4,\
    OriginAccessControlOriginType=s3
```

This command returns the OAC ID, which you'll need when associating it with a distribution.

**Step 2: Update or Create Your CloudFront Distribution**

If you're creating a new distribution, select the OAC you just created in the origin configuration. If you're migrating an existing distribution from OAI to OAC, you'll replace the OAI reference with the new OAC in the CloudFront distribution settings.

When you save the distribution, CloudFront immediately begins signing requests to your S3 origin with SigV4. Any unsigned requests (direct S3 access, or requests from other services) will now be denied.

**Step 3: Update the S3 Bucket Policy**

This is where the security model becomes explicit. You need to replace any OAI-based bucket policy with an OAC-based policy. Here's a concrete example:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "StringEquals": {
          "aws:SourceArn": "arn:aws:cloudfront.amazonaws.com:123456789012:distribution/E1234ABCD5"
        }
      }
    },
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "cloudfront.amazonaws.com"
      },
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::my-bucket",
      "Condition": {
        "StringEquals": {
          "aws:SourceArn": "arn:aws:cloudfront.amazonaws.com:123456789012:distribution/E1234ABCD5"
        }
      }
    }
  ]
}
```

Notice the key difference: the `Principal` is now the CloudFront service itself, not a specific identity. The `Condition` uses `aws:SourceArn` to specify which CloudFront distribution (identified by its distribution ID) is allowed. The ARN format is `arn:aws:cloudfront.amazonaws.com:ACCOUNT-ID:distribution/DISTRIBUTION-ID`.

When you create a new distribution with OAC, the CloudFront console can generate this policy for you automatically—it's one of the most helpful features of the migration flow.

### Handling KMS Encryption with OAC

If your S3 bucket uses server-side encryption with a customer-managed KMS key (SSE-KMS), you need an additional piece: a KMS key policy that grants CloudFront permission to decrypt objects.

**Why the KMS Key Policy Matters**

When CloudFront retrieves an encrypted object, it doesn't just read the object metadata—S3 automatically decrypts the object using the specified KMS key. S3 makes a call to KMS on CloudFront's behalf, asking KMS to decrypt the encryption key that protects the object. If the KMS key policy doesn't explicitly grant CloudFront permission to use that key, the decryption fails, and your distribution returns access denied errors.

**Crafting the KMS Key Policy**

You need to add a statement to your customer-managed KMS key policy allowing the CloudFront service principal to perform decrypt operations. Here's the policy statement:

```json
{
  "Sid": "AllowCloudFrontToDecryptObjects",
  "Effect": "Allow",
  "Principal": {
    "Service": "cloudfront.amazonaws.com"
  },
  "Action": [
    "kms:Decrypt",
    "kms:DescribeKey"
  ],
  "Resource": "*"
}
```

If you want to be more restrictive and limit this to specific CloudFront distributions or even specific S3 buckets, you can add a `Condition`:

```json
{
  "Sid": "AllowCloudFrontToDecryptObjectsFromSpecificBucket",
  "Effect": "Allow",
  "Principal": {
    "Service": "cloudfront.amazonaws.com"
  },
  "Action": [
    "kms:Decrypt",
    "kms:DescribeKey"
  ],
  "Resource": "*",
  "Condition": {
    "StringEquals": {
      "kms:ViaService": "s3.us-east-1.amazonaws.com"
    }
  }
}
```

The `kms:ViaService` condition restricts the permission to decryption requests that come through the specific S3 endpoint. This is an excellent practice when you have fine-grained security requirements.

### Migration Path: Moving from OAI to OAC

If you're running CloudFront distributions with OAI today, here's a safe, tested migration strategy that minimizes risk.

**Phase 1: Preparation and Testing**

Before touching production, set up a test distribution with OAC and verify it works. Create a small S3 bucket with a few test objects, configure a CloudFront distribution using OAC, and validate that you can retrieve objects through CloudFront and that direct S3 access is blocked.

If your bucket uses SSE-KMS, test with an encrypted object to ensure the KMS key policy is correctly configured. Try accessing the object through CloudFront (should succeed) and directly from S3 using anonymous credentials (should fail).

**Phase 2: Dual Configuration (If Risk-Averse)**

For critical distributions, some teams prefer running both OAI and OAC for a short period. Create the OAC, update the bucket policy to trust both the OAI and OAC, and update the distribution to use OAC. Leave the OAI in place for a few days while you monitor CloudFront access logs and error rates.

In your CloudFront access logs, you'll see the requests now being signed with SigV4 and bearing the OAC's signature. Once you're confident everything is working, remove the OAI-related statement from the bucket policy.

**Phase 3: Full Migration**

For the actual migration:

1. Note down the IDs of all distributions using OAI.
2. For each distribution, create a new OAC (or reuse one if multiple distributions can share it).
3. Update the distribution to reference the new OAC instead of the OAI.
4. Update the S3 bucket policy to remove OAI permissions and add OAC permissions with appropriate `aws:SourceArn` conditions.
5. Monitor CloudFront access logs for 24 hours to ensure no unexpected errors.
6. Delete the OAI if it's no longer used by any distribution.

The entire process can typically be done without downtime because CloudFront begins signing requests immediately after you update the distribution configuration.

### Troubleshooting Access Denied Errors

Even with careful configuration, things sometimes go wrong. Here's how to diagnose the most common issues.

**Scenario 1: 403 Access Denied After Enabling OAC**

If CloudFront returns 403 errors after you enable OAC, the most common culprit is a bucket policy that doesn't include the OAC. Verify that your bucket policy explicitly allows the CloudFront service principal with the correct distribution ARN in the `aws:SourceArn` condition.

Check the S3 bucket policy in the AWS console under the bucket's Permissions tab. If you see an old OAI-based policy still there, that's the problem—the bucket policy doesn't match the distribution's new authentication method.

**Scenario 2: 403 with SSE-KMS and OAC**

If you've enabled OAC but your bucket uses SSE-KMS, and you're seeing access denied errors, the issue is almost certainly the KMS key policy. CloudFront successfully reads the object metadata, but S3's attempt to decrypt the encryption key fails because KMS doesn't allow CloudFront to perform the decrypt operation.

Check the KMS key policy and ensure it includes a statement granting `kms:Decrypt` and `kms:DescribeKey` permissions to the `cloudfront.amazonaws.com` service principal. Remember that KMS key policies can take a few minutes to propagate, so wait a moment after editing and try again.

**Scenario 3: 403 for Some Objects but Not Others**

If CloudFront successfully retrieves some objects but fails on others, check whether the failing objects are encrypted with a different KMS key than the passing objects. Organizations often have multiple keys for different data classifications. Ensure all relevant KMS keys include the CloudFront permissions.

**Scenario 4: Direct S3 Access Still Works**

If you're able to access objects directly via S3 URLs despite configuring OAC, your bucket policy is either missing or incorrect. The bucket policy is what enforces the restriction—OAC only tells CloudFront how to authenticate. Without a bucket policy denying all public access and allowing only CloudFront, anyone with S3 permissions can still read the bucket.

Verify that your bucket policy includes an explicit Deny statement for public access, or at minimum, that the Allow statements are narrow enough that they only match CloudFront requests.

**Using CloudTrail for Deep Debugging**

When standard troubleshooting doesn't reveal the issue, enable CloudTrail logging for your S3 bucket and KMS key. CloudTrail records every API call, including authorization failures. Look for `s3:GetObject` calls with an error code—this will tell you exactly why the call was denied.

For KMS issues, CloudTrail logs show `kms:Decrypt` failures with detailed error messages. These logs are invaluable when debugging complex permission hierarchies.

### Best Practices and Architectural Considerations

Beyond just getting OAC working, there are patterns and practices that make your implementation more secure and maintainable.

**Use Specific Distribution ARNs**

Always reference the specific CloudFront distribution ARN in the bucket policy's `aws:SourceArn` condition. Avoid overly broad conditions like allowing all CloudFront distributions to access a bucket unless you have a specific architectural reason to do so. Specificity limits blast radius if a distribution is ever compromised.

**Organize OAC by Purpose**

Rather than reusing a single OAC across many distributions, consider creating separate OACs for different logical purposes: one for your static website assets, another for user-uploaded media, another for analytics data. This doesn't affect performance but makes it easier to audit access patterns and to disable or modify access for specific purposes without affecting others.

**Implement Bucket Versioning and MFA Delete**

OAC doesn't prevent object deletion if your bucket policy allows it. Use versioning and MFA delete to add an extra layer of protection for critical S3 buckets. This ensures that even if permissions are somehow misconfigured, objects can be recovered.

**Monitor CloudFront Access Logs**

Enable CloudFront access logs and periodically review them. Watch for spikes in 403 errors, which might indicate attempted unauthorized access. Use CloudFront's built-in metrics and log analysis tools to detect anomalies.

**Document Your OAC Mappings**

Keep a simple document or spreadsheet mapping distributions to OACs to S3 buckets. As your infrastructure grows, this becomes invaluable for onboarding new team members and auditing access.

### Conclusion

Origin Access Control represents a meaningful evolution in how we secure CloudFront distributions backed by S3. By using SigV4 request signing, OAC provides superior security, broader regional support, and full compatibility with customer-managed KMS encryption—addressing every limitation of the legacy OAI approach. While OAI still works and remains supported, AWS clearly views OAC as the standard path forward.

The migration from OAI to OAC is straightforward when you understand the mechanics: create the OAC, update the distribution to use it, and craft a bucket policy that explicitly trusts requests from that distribution. If encryption is involved, add the necessary KMS permissions. When issues arise—which they occasionally do—CloudTrail and careful policy review will get you to the root cause.

Whether you're building a new CloudFront distribution today or modernizing an existing one, OAC should be your default choice. The time investment in understanding and implementing it correctly pays dividends in security, auditability, and peace of mind.
