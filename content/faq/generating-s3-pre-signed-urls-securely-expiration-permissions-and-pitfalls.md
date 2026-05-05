---
title: "Generating S3 Pre-signed URLs Securely: Expiration, Permissions, and Pitfalls"
---

## Generating S3 Pre-signed URLs Securely: Expiration, Permissions, and Pitfalls

Pre-signed URLs are a deceptively simple feature that solves a common problem: you want to grant someone temporary access to an S3 object without managing long-lived credentials. Generate a URL, send it to a user, and they can download or upload to that specific object for a limited time. Sounds straightforward, right? In practice, pre-signed URLs are a rich source of security misconfigurations and surprising behavior that can leak permissions, create compliance violations, or simply expire when you least expect it.

Understanding the mechanics of pre-signed URL generation is critical for anyone building applications on AWS. This guide moves beyond the basic "here's how to generate one" tutorial and explores the nuances that actually matter: how expiration time works differently depending on your authentication method, why the signer's permissions matter more than you might think, how to layer additional restrictions on top of a URL, and how encryption complicates the picture. These details show up frequently in real-world code reviews and on certifications that test practical AWS knowledge.

### How Pre-signed URLs Work at a Fundamental Level

A pre-signed URL is essentially a time-bound credential encoded into a URL string. Instead of requiring the client to possess AWS credentials, you (someone with valid AWS credentials) cryptographically sign a request on behalf of that client. The signature proves that the request was authorized by someone with credentials at a specific point in time, for a specific action, on a specific resource.

When you generate a pre-signed URL in your application, the AWS SDK creates a URL that contains a signature (often called the "SigV4" signature, short for AWS Signature Version 4). This signature is derived from several inputs: the HTTP method (GET, PUT, POST), the S3 bucket and object name, query parameters, headers, the current timestamp, and your AWS credentials. The client then sends this URL as-is to a third party or uses it directly. S3 receives the request, recalculates the signature using the same inputs, and compares it to the one in the URL. If they match and the expiration time hasn't passed, the request succeeds.

The critical insight is that the signature depends on *who is signing*—that is, whose credentials are used to generate the URL. If you sign a pre-signed URL while authenticated as an IAM user or role with specific permissions, the URL can only grant access to actions that those credentials would allow. This is not a limitation; it's by design. But it's also a common source of confusion and misconfiguration.

### Understanding Expiration Times and the Seven-Day Limit

One of the most misunderstood aspects of pre-signed URLs is the maximum expiration time. The answer is not simply "as long as you want"—it depends on how you're generating the URL.

When you use the AWS SDK (boto3, Java SDK, JavaScript SDK, etc.) to generate a pre-signed URL, you specify an expiration time as a parameter, usually called something like `ExpiresIn` (measured in seconds). The default is often 3600 seconds (one hour), but you can increase this. Here's the crucial limit: **when using AWS Signature Version 4 (SigV4), the maximum expiration time is 604,800 seconds—exactly seven days**.

This limit applies regardless of your intent or your application's needs. If you try to set an expiration time beyond seven days, the SDK typically silently clamps it to seven days, though behavior varies slightly across SDKs and SDK versions. Why this limit? It's a security measure. S3 designed it to reduce the window of time during which a leaked URL remains usable. A pre-signed URL is, in many ways, a bearer token—if someone obtains it, they can use it—so limiting its lifespan reduces risk.

However, there's a crucial twist: **if you generate a pre-signed URL from an EC2 instance role (or any temporary security credentials), the maximum expiration time is actually shorter: 36 hours (129,600 seconds)**. This is because temporary credentials themselves have a limited lifetime, and a pre-signed URL cannot outlive the credentials that signed it. When you assume a role on an EC2 instance, you receive temporary credentials with a specific expiration time (often 12 hours for normal role assumptions, but it can vary). If your temporary credentials expire at time T, any pre-signed URL you sign with those credentials becomes useless at time T, regardless of what expiration time you specified.

Let's make this concrete with an example. Suppose you're running a Lambda function that processes user uploads. Your Lambda has an execution role attached. When Lambda invokes your function, it provides temporary credentials good for one hour. If you generate a pre-signed URL with an `ExpiresIn` of 86,400 seconds (24 hours), the URL will actually become invalid after one hour, when the Lambda's temporary credentials expire. The signature verification will fail because the credentials that signed the URL no longer exist.

This behavior catches developers off guard because the SDK doesn't typically warn you. It happily accepts your 24-hour expiration request and generates the URL. Then, mysteriously, the URL stops working after an hour. Understanding this relationship between credential lifetime and pre-signed URL validity is essential for designing reliable systems.

### The Permission Model: Why the Signer's Identity Matters

Here's where many developers trip up: a pre-signed URL doesn't grant permissions in isolation. Instead, it *delegates* the signer's existing permissions to the client. If you, as the signer, don't have permission to perform an action, no pre-signed URL you generate will grant that permission to someone else.

This seems intuitive, but the inverse is where problems emerge. If you *do* have permission to perform an action, and you generate a pre-signed URL, then anyone with that URL can perform that action as if they had your credentials. The URL doesn't narrow permissions—it only sets a time limit.

Consider a practical scenario: your application needs to allow users to upload files to S3. You create an IAM role for your application with `s3:PutObject` permission on a specific bucket, plus `s3:GetObject` permission on everything in that bucket (because the app also lists and downloads files). When your application generates a pre-signed URL for a user to upload a single file, that's appropriate—the URL permits exactly what you intended.

But now suppose your application's IAM role has broader permissions. Perhaps it has `s3:*` on the entire bucket for operational convenience. When you generate a pre-signed URL for a user to upload a file, that URL could theoretically be used to delete other objects, modify bucket policies, or perform any S3 operation—because the credentials you signed with have those permissions. The URL itself doesn't constrain the user to just the `PutObject` action on a single object; it constrains the user to whatever that credentials set allows.

This is why the principle of least privilege is not just a security best practice—it's a functional requirement when distributing pre-signed URLs. Your application's credentials should have only the permissions it needs. If your app doesn't need to delete objects, don't grant `s3:DeleteObject`, so even if a malicious actor gets a pre-signed URL, deletion is not possible.

The other side of this coin is the HTTP method embedded in the URL. When you generate a pre-signed URL, you specify the HTTP method: GET (to download), PUT (to upload), POST (for form uploads), DELETE, or HEAD. The signature includes this method, so a URL signed for GET cannot be used to perform a PUT, even if the credentials have PutObject permissions. This is a valuable defense-in-depth control.

### Restricting Pre-signed URLs with Bucket Policies and Conditions

Pre-signed URLs sit at the intersection of two permission systems in S3: IAM (which controls who can make requests) and bucket policies (which can further restrict what happens). A common misconception is that a pre-signed URL is somehow exempt from bucket policy restrictions. It isn't. When S3 evaluates a request made with a pre-signed URL, it still applies the bucket policy.

This creates an opportunity: you can use bucket policies to layer additional restrictions on top of pre-signed URLs, restricting access by IP address, requiring specific headers, or enforcing content type constraints. These restrictions apply regardless of whether a request uses a pre-signed URL, regular credentials, or anything else.

For example, suppose you want to allow your application to generate pre-signed URLs for file uploads, but you only want uploads to come from your corporate VPC. You can't express this restriction in the IAM policy (which only says who, not where). Instead, you add a condition to the bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "IpAddress": {
          "aws:SourceIp": [
            "10.0.0.0/8"
          ]
        }
      }
    }
  ]
}
```

Now, even if someone obtains a valid pre-signed URL, they can only use it to upload if their IP is in the specified range. The bucket policy condition is evaluated regardless of the signature in the pre-signed URL.

Similarly, you can enforce that uploads must include a specific header or have a specific content type. For instance:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-bucket/*",
      "Condition": {
        "StringEquals": {
          "s3:x-amz-server-side-encryption": "AES256"
        }
      }
    }
  ]
}
```

This policy requires that all uploads to the bucket be encrypted with AES256 server-side encryption. If a pre-signed URL doesn't include this header, the upload will fail, even though the URL is valid and signed.

Bucket policies are a powerful complement to pre-signed URL generation. They provide a second layer of control that the URL signer and client cannot circumvent. When designing a system that uses pre-signed URLs, think about what restrictions should apply at the bucket level versus what should be encoded in the URL itself.

### SigV4 Query String vs. Authorization Header Signatures

Pre-signed URLs are not the only way to sign AWS requests. When you make an API call using the AWS SDK, you're typically using an Authorization header that contains your signature. Pre-signed URLs, by contrast, encode the signature into the URL query string. Both approaches use the same underlying signature algorithm (SigV4), but they have different implications.

When you generate a pre-signed URL, the signature appears as a query parameter. For example, a pre-signed URL might look like:

```
https://my-bucket.s3.amazonaws.com/my-object?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20240115%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20240115T120000Z&X-Amz-Expires=3600&X-Amz-SignedHeaders=host&X-Amz-Signature=1234567890abcdef...
```

Notice the `X-Amz-Credential`, `X-Amz-Date`, `X-Amz-Expires`, and `X-Amz-Signature` parameters. These encode everything needed for S3 to verify the request. The advantage of query-string signatures is that they work with plain HTTP requests (a browser can simply fetch the URL) and you can include the signature in a URL you send to someone else. The disadvantage is that the signature is visible in server logs, browser history, and anywhere URLs are logged.

In contrast, when you make an SDK call with explicit credentials, the signature goes into the Authorization header:

```
Authorization: AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20240115/us-east-1/s3/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=1234567890abcdef...
```

This approach is more private—the signature is less likely to be logged—but it requires the client to make an SDK call rather than a simple HTTP request.

For most pre-signed URL use cases, the query-string approach is the intended method. However, you should be aware that query-string signatures do appear in logs. If you're distributing pre-signed URLs to external parties and concerned about logging, consider using short expiration times and reviewing access logs carefully.

There's also a practical difference in how clients use each approach. With a pre-signed URL, a client with just a web browser can access the resource by visiting the URL. With an Authorization header, the client needs an AWS SDK or the ability to construct the header manually. Pre-signed URLs are more accessible; headers are more secure in certain contexts.

### Pre-signed URLs and KMS Encryption

KMS encryption adds another layer to the pre-signed URL picture. When an S3 object is encrypted with a customer master key (CMK) in AWS Key Management Service, you need permission to use that key, not just permission to access the object itself.

Here's how it works: suppose your S3 bucket contains an object encrypted with KMS. When you attempt to download that object (using a pre-signed URL or any other method), S3 decrypts the object, but to do so, it must call KMS to decrypt the data key used for the object. This KMS call requires that the caller (the principal making the request) has permission to use the key.

If you generate a pre-signed URL while authenticated as a principal that doesn't have `kms:Decrypt` permission for the relevant key, the URL will fail. More specifically, the download will fail at the point where S3 tries to decrypt, even though S3 itself authorized the download based on the bucket policy and pre-signed URL signature.

This is a crucial detail for multi-tenant applications. Imagine your service generates pre-signed URLs for users to download their files. If you generate those URLs while authenticated as an application service account, and that service account doesn't have KMS permissions, the URLs will work—as long as they're used by a principal with KMS permissions. But if you're trying to provide "anonymous" downloads (URLs without requiring AWS credentials), and the objects are KMS-encrypted, you need to configure the bucket policy and key policy in a very specific way to allow unauthenticated access.

In most cases, KMS encryption of S3 objects used with pre-signed URLs requires careful coordination of IAM policies, key policies, and bucket policies. The general rule: the principal using the pre-signed URL must have explicit permission to use the KMS key, unless you've granted those permissions to a very broad principal (like all users in your account, or even `*` if using bucket policies correctly).

When designing a system with KMS encryption, it's often simpler to use S3 server-side encryption with S3-managed keys (SSE-S3) rather than KMS if the complexity isn't justified by your security requirements. However, if you need the audit trail and granular control that KMS provides, budget time for properly configuring the permissions.

### Common Pitfalls and Best Practices

Beyond the technical mechanics, pre-signed URLs harbor several gotchas that catch developers in production systems.

**Expiration time and credential lifetime mismatches** are the most common source of bugs. Always test pre-signed URL generation from temporary credentials (like Lambda execution roles) with realistic expiration times. If you're generating a URL that you expect to be valid for 24 hours, but your Lambda credentials only last 12 hours, you'll have a problem. A practical approach: keep pre-signed URL expiration times modest—often one hour is sufficient—or, for longer-lived URLs, use IAM users with long-lived access keys (though this introduces other security considerations).

**Overly broad IAM permissions** are the biggest security risk. Your application should have exactly the permissions it needs, nothing more. Don't grant `s3:*` when `s3:PutObject` and `s3:GetObject` on specific resources suffice. This limits the damage if your application is compromised or a pre-signed URL is misused.

**Forgetting to include the HTTP method** when generating a URL is a subtle but important mistake. If you generate a pre-signed URL without specifying the method, the default (often GET) is used. If your code later tries to use the same URL for a PUT, it will fail. Always explicitly specify the method.

**Not validating metadata in pre-signed URL creation** can lead to inconsistencies. If you're generating a pre-signed URL for a user to upload a file, consider embedding metadata (like an expected content type or size limit) in the bucket policy conditions. This prevents users from uploading arbitrary data under the guise of a pre-signed URL.

**Logging concerns** deserve attention. Pre-signed URLs appear in logs, and their signatures are sensitive. Consider using a log filter to redact or mask the signature portion of pre-signed URLs before logging. Some organizations use very short expiration times for pre-signed URLs specifically to limit the window during which a leaked URL from logs could be exploited.

**Testing across different AWS credential types** is essential. Test pre-signed URL generation from IAM users, IAM roles, federated credentials, and temporary credentials. The behavior differs slightly, and you'll catch issues early if you test comprehensively. In particular, test expiration behavior from EC2 instance roles and Lambda execution roles, where the credential lifetime constraint is most likely to surprise you.

### Practical Implementation Example

Let's walk through a realistic example: an application that allows users to upload images. The application needs to generate a pre-signed URL that users can use to upload an image without AWS credentials.

```python
import boto3
from datetime import timedelta

# Create an S3 client with the application's credentials
s3_client = boto3.client('s3')

def generate_upload_url(bucket_name, object_key, expiration_seconds=3600):
    """
    Generate a pre-signed URL for uploading an object to S3.
    
    Args:
        bucket_name: S3 bucket name
        object_key: The key (path) where the object will be stored
        expiration_seconds: URL expiration time (default 1 hour, max 604800 seconds)
    
    Returns:
        A pre-signed URL for uploading
    """
    # Clamp expiration to 7 days maximum (or shorter if using temporary credentials)
    max_expiration = 604800  # 7 days in seconds
    expiration = min(expiration_seconds, max_expiration)
    
    try:
        url = s3_client.generate_presigned_url(
            ClientMethod='put_object',
            Params={
                'Bucket': bucket_name,
                'Key': object_key,
                'ContentType': 'image/jpeg',  # Specify expected content type
            },
            ExpiresIn=expiration,
            HttpMethod='PUT'
        )
        return url
    except Exception as e:
        print(f"Error generating pre-signed URL: {e}")
        return None
```

The application's IAM role would have a policy like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::my-bucket/uploads/*"
    }
  ]
}
```

Notice that the role has only `PutObject` permission, not broader S3 permissions. The bucket policy could add further restrictions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-bucket/uploads/*",
      "Condition": {
        "StringEquals": {
          "s3:x-amz-server-side-encryption": "AES256"
        },
        "StringLike": {
          "s3:x-amz-content-type": "image/*"
        }
      }
    }
  ]
}
```

This policy ensures that uploads must be encrypted and must have an image content type, even if a pre-signed URL is misconfigured. The layers of control—the IAM role, the pre-signed URL parameters, and the bucket policy—all work together to provide defense in depth.

### Conclusion

Pre-signed URLs are a powerful mechanism for granting temporary access to S3 objects, but they demand a nuanced understanding of how permissions, expiration, and signatures interact. The maximum seven-day expiration time (or 36 hours when using temporary credentials) is a hard limit rooted in security design. The permissions you have when signing determine what the URL can be used for—narrowing permissions at the source is essential. Bucket policies provide a crucial second layer of control, allowing you to enforce conditions that the URL itself cannot override. And KMS encryption, when present, introduces an additional permission check that must be satisfied independently.

When you're designing systems that distribute pre-signed URLs, think in layers. Start with least privilege in your IAM roles. Specify the exact HTTP method and parameters needed for each URL. Use bucket policies to enforce additional restrictions. Keep expiration times as short as practical. Test against realistic credential scenarios. And always remember: a pre-signed URL is a delegated credential, and like any credential, it should be treated with care.

The developers who build the most reliable and secure S3-based systems are those who understand not just how to generate a pre-signed URL, but why each component matters and what can go wrong when assumptions are violated.
