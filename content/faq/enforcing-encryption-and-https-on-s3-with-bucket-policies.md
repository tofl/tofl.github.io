---
title: "Enforcing Encryption and HTTPS on S3 with Bucket Policies"
---

## Enforcing Encryption and HTTPS on S3 with Bucket Policies

Amazon S3 is the backbone of data storage across millions of AWS applications, but with that power comes responsibility. Every day, organizations inadvertently expose sensitive data through misconfigured buckets, unencrypted uploads, or insecure connections. The good news? AWS gives you the tools to prevent these problems before they happen.

Bucket policies are your first line of defense. They act as gatekeepers, allowing you to define exactly who can access your S3 buckets, how they can access them, and under what conditions. In this guide, we'll explore how to write policies that enforce encryption in transit and at rest, prevent public exposure, and implement security controls that align with industry best practices.

Whether you're hardening an existing environment or building security into new applications, understanding how to craft these policies will make you a more effective AWS developer and architect.

### Understanding S3 Bucket Policies and Why They Matter

A bucket policy is a JSON document attached directly to an S3 bucket that controls access and permissions. Unlike bucket ACLs, which offer coarse-grained control, bucket policies give you fine-grained authority over who can perform which actions and under what conditions.

Think of a bucket policy as a bouncer at a club with a very specific checklist. Every request to your bucket—whether it's uploading a file, listing objects, or deleting keys—passes through this policy. If the request doesn't meet the criteria you've defined, it gets denied.

What makes bucket policies particularly powerful for security is the ability to use conditions. These conditions check properties of the request itself: Is it using HTTPS? Does the upload include server-side encryption? Is it coming from a specific IP address? By leveraging conditions, you can enforce security requirements systematically across your entire bucket.

The policies we'll discuss in this article follow the principle of least privilege and defense in depth. Instead of hoping developers will do the right thing, you're making it impossible for them to do anything else.

### The aws:SecureTransport Condition: Enforcing HTTPS

Data in motion is vulnerable. Anyone with network access between your application and S3 could potentially intercept your traffic if it travels over plain HTTP. The solution is straightforward: enforce HTTPS for all communication.

The `aws:SecureTransport` condition checks whether a request was made using a secure connection (HTTPS/TLS). When set to `false`, it denies any request that doesn't use HTTPS. Here's how to implement it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::my-secure-bucket",
        "arn:aws:s3:::my-secure-bucket/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    }
  ]
}
```

This policy denies all S3 actions on the bucket if the request isn't encrypted in transit. Notice that we're using a Deny statement with `Principal: "*"` rather than an Allow. This is a key security pattern: explicit denials are more powerful than allows because they apply to everyone, including root users and even the bucket owner.

When should you use this? Always. There's virtually no legitimate reason to allow unencrypted traffic to S3. Even internal AWS services and SDKs support HTTPS. If you're working with legacy systems that only support HTTP, you should be looking at refactoring, not relaxing your security policy.

One practical consideration: some older tools or scripts might not properly handle HTTPS by default. When you apply this policy, test your integrations thoroughly. The error message your application receives when this policy is violated will be an access denied error, so you'll know exactly what's happening.

### Server-Side Encryption: The s3:x-amz-server-side-encryption Condition

Encryption at rest protects your data when it's stored in S3. AWS provides two main options: SSE-S3 (managed by AWS) and SSE-KMS (using AWS Key Management Service). The `s3:x-amz-server-side-encryption` condition allows you to require that every upload includes encryption.

Here's a policy that requires encryption for all uploads:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyUnencryptedObjectUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-secure-bucket/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": [
            "AES256",
            "aws:kms"
          ]
        }
      }
    }
  ]
}
```

This policy denies any PutObject request where the encryption method is neither AES256 (SSE-S3) nor aws:kms (SSE-KMS). The developer uploading the file must explicitly specify one of these encryption methods, either through the AWS SDK, CLI, or console.

The benefit of this approach is flexibility: it doesn't force a specific encryption method, allowing your team to choose AES256 for less sensitive data or KMS for highly sensitive information. However, if you want to enforce a specific encryption method—say, always using KMS for compliance reasons—you can tighten the condition further.

### Requiring a Specific KMS Key: The s3:x-amz-server-side-encryption-aws-kms-key-id Condition

When you use SSE-KMS, you're leveraging AWS Key Management Service to manage encryption keys. This gives you more control than SSE-S3: you can rotate keys, audit their usage, and restrict who can decrypt data. But you might want to go further and require that uploads use a specific KMS key.

This is particularly useful in regulated environments where you need to ensure that sensitive data is encrypted with a particular key that has been through compliance review. Here's how to enforce it:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyWrongKMSKey",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-secure-bucket/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
        }
      }
    }
  ]
}
```

You'll need to replace that ARN with your actual KMS key ARN. You can find this in the AWS Key Management Service console or by querying your key's details via the CLI.

When combined with the previous condition, you're now saying: "All uploads must be encrypted with KMS, and they must use this specific key." This is powerful because it creates a hard requirement that can't be accidentally bypassed.

One detail worth noting: developers uploading files will need to have permissions to use this specific KMS key through their identity policies as well. The bucket policy enforces what's required at the S3 side, but the KMS key policy must also grant the appropriate permissions. It's a two-part authorization check, which ensures defense in depth.

### Combining Encryption Conditions for Comprehensive Protection

Now let's look at a more complete policy that brings these conditions together:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::my-secure-bucket",
        "arn:aws:s3:::my-secure-bucket/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    },
    {
      "Sid": "DenyUnencryptedObjectUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-secure-bucket/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    },
    {
      "Sid": "DenyWrongKMSKey",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-secure-bucket/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
        }
      }
    }
  ]
}
```

This three-statement policy creates a security posture where your bucket is accessible only over HTTPS, all uploads must use KMS encryption, and that encryption must use a specific, pre-approved key. An attacker or misconfigured application trying to upload unencrypted data over HTTP would be blocked at every step.

### Preventing Public Access: Denying Public ACLs and Policies

Encryption protects data in transit and at rest, but it doesn't help if unauthorized users can access your bucket outright. One of the most common S3 security incidents stems from buckets being accidentally made public through overly permissive ACLs or policies.

You can prevent this by explicitly denying any operation that would make your bucket or objects public:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyPublicACLs",
      "Effect": "Deny",
      "Principal": "*",
      "Action": [
        "s3:PutObjectAcl",
        "s3:PutBucketAcl"
      ],
      "Resource": [
        "arn:aws:s3:::my-secure-bucket",
        "arn:aws:s3:::my-secure-bucket/*"
      ],
      "Condition": {
        "StringLike": {
          "s3:x-amz-acl": [
            "public-read",
            "public-read-write"
          ]
        }
      }
    },
    {
      "Sid": "DenyPublicPolicies",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutBucketPolicy",
      "Resource": "arn:aws:s3:::my-secure-bucket",
      "Condition": {
        "Bool": {
          "aws:PrincipalIsAWSService": "false"
        }
      }
    }
  ]
}
```

The first statement blocks any attempt to set a public ACL on objects or the bucket itself. The second is trickier: it prevents non-AWS services from attaching policies to the bucket. In practice, you'd refine this further based on your needs.

However, bucket policies alone aren't always sufficient for preventing public access, especially against policy changes. This is where S3 Block Public Access comes in.

### S3 Block Public Access: A Bulletproof Defense

S3 Block Public Access is a feature that operates independently of bucket policies. It sits at both the account level and the bucket level, providing a secondary enforcement mechanism that prevents public access even if someone manages to modify your bucket policy.

Block Public Access has four settings:

Block all public access through ACLs allows you to prevent anyone from making objects or buckets publicly readable or writable via ACL operations. Block all public access through bucket policies prevents bucket policies from granting public access. Ignore all public ACLs treats all ACLs as if they were private, even if they were set to public. Finally, restrict public bucket policies prevents bucket policies that grant public access from having any effect.

You should enable all four of these settings for any bucket containing sensitive data. Here's how to do it via the CLI:

```bash
aws s3api put-public-access-block \
  --bucket my-secure-bucket \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

You can also apply Block Public Access at the account level, which sets a default for all buckets in the account:

```bash
aws s3api put-account-public-access-block \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

The beauty of Block Public Access is that it's nearly impossible to accidentally circumvent. Even if an IAM user has permissions to modify the bucket policy, Block Public Access will prevent the policy from taking effect if it would grant public access. It's a safety net that catches mistakes and provides defense in depth.

### Putting It All Together: A Production-Ready Policy

Let's create a comprehensive bucket policy that combines everything we've discussed:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyInsecureTransport",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::my-secure-bucket",
        "arn:aws:s3:::my-secure-bucket/*"
      ],
      "Condition": {
        "Bool": {
          "aws:SecureTransport": "false"
        }
      }
    },
    {
      "Sid": "DenyUnencryptedObjectUploads",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-secure-bucket/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption": "aws:kms"
        }
      }
    },
    {
      "Sid": "DenyWrongKMSKey",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-secure-bucket/*",
      "Condition": {
        "StringNotEquals": {
          "s3:x-amz-server-side-encryption-aws-kms-key-id": "arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012"
        }
      }
    },
    {
      "Sid": "DenyPublicACLs",
      "Effect": "Deny",
      "Principal": "*",
      "Action": [
        "s3:PutObjectAcl",
        "s3:PutBucketAcl"
      ],
      "Resource": [
        "arn:aws:s3:::my-secure-bucket",
        "arn:aws:s3:::my-secure-bucket/*"
      ],
      "Condition": {
        "StringLike": {
          "s3:x-amz-acl": [
            "public-read",
            "public-read-write"
          ]
        }
      }
    },
    {
      "Sid": "AllowEncryptedUploads",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/ApplicationRole"
      },
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-secure-bucket/*"
    },
    {
      "Sid": "AllowReading",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/ApplicationRole"
      },
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::my-secure-bucket",
        "arn:aws:s3:::my-secure-bucket/*"
      ]
    }
  ]
}
```

This policy implements layered security. The first four statements are Deny statements that block insecure operations, and the last two are Allow statements that grant your application role the permissions it actually needs. By combining explicit denies with specific allows, you create a policy that's both secure and functional.

### Best Practices and Common Pitfalls

When writing S3 bucket policies for security, keep a few principles in mind. First, always use Deny statements to enforce security requirements. Deny statements are more powerful because they apply universally, and they can't be accidentally overridden by other policies. Second, test your policies thoroughly before applying them to production buckets. A misconfigured policy can block legitimate traffic and cause outages.

Third, remember that bucket policies work in conjunction with other AWS security features. Your bucket policy might deny unencrypted uploads, but if the KMS key policy doesn't grant the uploader permission to use the key, the upload will still fail. You need to ensure alignment across bucket policies, key policies, and identity policies.

Fourth, be cautious with wildcards in principals. While `"Principal": "*"` is necessary for enforcing conditions universally, it's also important to audit your Allow statements to ensure they're not inadvertently granting broad access. When you use Allow statements, specify exact principals whenever possible.

Finally, regularly audit your bucket policies and Block Public Access settings. As your organization grows and applications change, policies that made sense initially might become outdated. Use AWS Config to monitor your S3 bucket configurations and alert you to any changes.

### Working with the AWS CLI and SDKs

When your bucket policy requires specific encryption, developers will need to know how to comply. Here's how to upload a file with KMS encryption using the AWS CLI:

```bash
aws s3 cp myfile.txt s3://my-secure-bucket/ \
  --sse aws:kms \
  --sse-kms-key-id arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012
```

And using the Python boto3 SDK:

```python
import boto3

s3_client = boto3.client('s3')

s3_client.put_object(
    Bucket='my-secure-bucket',
    Key='myfile.txt',
    Body=open('myfile.txt', 'rb'),
    ServerSideEncryption='aws:kms',
    SSEKMSKeyId='arn:aws:kms:us-east-1:123456789012:key/12345678-1234-1234-1234-123456789012'
)
```

When developers try to upload without the required encryption, they'll receive an error. It's helpful to document these requirements for your team so they understand why uploads are failing and how to fix them.

### Monitoring and Troubleshooting

When you implement these policies, you should monitor their effects. CloudTrail logs all API calls to S3, including denied requests. If you want to identify which applications or users are being blocked, you can query CloudTrail for AccessDenied events:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=my-secure-bucket \
  --max-results 10
```

S3 Access Logs can also be helpful. By enabling server access logging on your bucket, you can see a detailed history of requests, including those that were denied by your policies.

If you need to debug a specific issue, start by checking the error message. S3 will typically indicate whether a request was denied by a bucket policy, a key policy, or insufficient IAM permissions. Each has a distinct error signature that helps you pinpoint the problem.

### Conclusion

Securing S3 is fundamentally about making it impossible to accidentally or intentionally compromise your data. Bucket policies give you the tools to enforce encryption in transit and at rest, prevent public access, and require specific KMS keys for the most sensitive information. Combined with S3 Block Public Access, you create a defense-in-depth approach that protects against misconfigurations and user error.

The policies and practices outlined in this guide are not just security theater—they directly address real-world vulnerabilities that have led to significant data breaches. By implementing these controls, you're taking responsibility for your data security and building a foundation of trust in your infrastructure.

Start by assessing which of these requirements apply to your buckets. A bucket containing public datasets might need only HTTPS enforcement, while a bucket containing customer data should implement all the controls discussed here. As you implement these policies, document them for your team, monitor their effects, and adjust as your needs evolve. Security is not a one-time setup but an ongoing practice of vigilance and improvement.
