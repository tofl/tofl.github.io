---
title: "EC2 Instance Metadata Service v1 vs v2 (IMDSv2)"
---

## EC2 Instance Metadata Service v1 vs v2 (IMDSv2)

The EC2 Instance Metadata Service is one of those foundational AWS mechanisms that most developers interact with indirectly, without thinking much about it. Every time your application running on an EC2 instance needs to assume an IAM role and retrieve temporary security credentials, the metadata service is quietly handling that request. Yet understanding how it works—and the critical differences between its two versions—is essential for building secure, resilient applications on EC2.

In this article, we'll explore what the Instance Metadata Service is, why IMDSv2 was introduced, and how to properly leverage it in your applications. Whether you're troubleshooting credential retrieval issues, hardening your infrastructure, or simply trying to understand the plumbing under the hood, this deep dive will give you the clarity you need.

### What Is the EC2 Instance Metadata Service?

The Instance Metadata Service is a special web service that runs locally on every EC2 instance at a fixed, non-routable IP address: `169.254.169.254`. From within an instance, any process can make HTTP requests to this address to retrieve information about the instance itself—without needing to authenticate against the AWS API.

This might sound strange at first, but it's actually elegant. When you launch an instance with an IAM instance profile, the metadata service becomes the mechanism by which your applications retrieve temporary security credentials. Those credentials are automatically rotated by AWS, so your application doesn't need to manage long-lived keys. The instance profile and the metadata service work together to make credential management transparent.

The metadata service also provides other useful information: instance ID, availability zone, security group details, user data, and much more. But from a security standpoint, the credential retrieval aspect is what matters most, because a breach of the metadata service can potentially expose your AWS credentials.

### IMDSv1: The Original Design

In the beginning, there was only one version. When you wanted to retrieve metadata from within an EC2 instance, you simply made an HTTP GET request to the metadata service endpoint:

```bash
curl http://169.254.169.254/latest/meta-data/
curl http://169.254.169.254/latest/meta-data/iam/security-credentials/my-role-name
```

The metadata service would respond with the requested information, including temporary credentials if you asked for IAM role credentials. No authentication was required—if you could make an HTTP request from within the instance, you could read the metadata.

This simplicity was convenient, but it had a serious security flaw: **Server-Side Request Forgery (SSRF) vulnerability**. Imagine an attacker finds an SSRF vulnerability in your application running on EC2. They might craft a request that causes your application to fetch data from an arbitrary URL—for example, by exploiting a file download feature or an unsafe proxy implementation. An attacker could trick your application into making a request to `169.254.169.254` and reading the metadata, which would expose your AWS credentials.

The attack vector is particularly dangerous because the metadata service is accessible from any process running on the instance, regardless of which user or container is running it. In a multi-tenant environment like Kubernetes on EC2, or in a system with multiple containerized applications, this becomes a serious concern.

### Introducing IMDSv2: Token-Based Authentication

AWS introduced IMDSv2 in 2019 to address this vulnerability. Rather than allowing direct HTTP GET requests to the metadata service, IMDSv2 implements a token-based approach that's more resistant to SSRF attacks.

The two-step process works like this:

**Step 1: Obtain a session token**

The client first makes an HTTP PUT request (not GET) to a special endpoint with a specific header:

```bash
TOKEN=`curl -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600"`
```

This PUT request asks the metadata service for a session token. The `X-aws-ec2-metadata-token-ttl-seconds` header specifies how long the token should be valid—in this case, six hours (21600 seconds). The metadata service returns a token string.

**Step 2: Use the token to retrieve metadata**

Once you have the token, you include it in subsequent requests as a header:

```bash
curl -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/my-role-name
```

The metadata service validates the token before responding. Without a valid token, the request fails.

### Why IMDSv2 Defeats SSRF Attacks

The key insight is that IMDSv2 requires a PUT request to obtain the token. An HTTP PUT request is fundamentally different from a GET request in ways that matter for SSRF defense.

Many SSRF vulnerabilities arise from features that construct URLs and fetch them—think of a URL shortener service, a URL preview feature, or a web scraper. These typically follow HTTP GET semantics because that's how most web browsing works. An attacker can inject a malicious URL and the application fetches it.

However, making a PUT request is less common in typical application patterns. Most straightforward file downloads, URL fetches, and similar operations use GET. An SSRF vulnerability that allows arbitrary PUT requests is less common, and even then, the attacker needs to know to make a PUT request to that specific endpoint with that specific header to get a token.

In other words, IMDSv2 raises the bar significantly. It doesn't make the metadata service bulletproof against all SSRF attacks (a sophisticated attacker with deep control over your application might still exploit it), but it eliminates the simplest and most common attack vector.

### AWS SDK Behavior

Here's the good news for most developers: the AWS SDKs handle both IMDSv1 and IMDSv2 automatically. You don't typically need to manually construct these HTTP requests yourself.

When you use the AWS SDK for Python (Boto3), JavaScript (SDK v3), Java, or any other language, the SDK's credential provider chain includes a step that queries the EC2 Instance Metadata Service. The SDK is smart enough to handle both versions:

1. The SDK tries IMDSv2 first (PUT request with token).
2. If that fails (perhaps because the instance has IMDSv2 disabled or restricted), it falls back to IMDSv1 (simple GET request).
3. If both fail, it moves on to the next credential source in the chain.

This backward-compatible behavior means that existing applications continue to work even if you upgrade to IMDSv2. However, this fallback mechanism is precisely why AWS recommends *enforcing* IMDSv2, which we'll discuss next.

Here's a practical example using Boto3:

```python
import boto3

# This works seamlessly with either IMDSv1 or IMDSv2
client = boto3.client('s3')

# The SDK obtains credentials from the EC2 instance profile
# by querying the metadata service automatically
response = client.list_buckets()
print(response)
```

You don't see any token requests in your code—the SDK handles it behind the scenes. But that convenience masks a security decision: your application is still vulnerable if IMDSv1 is allowed, because an SSRF attacker could exploit that fallback.

### Enforcing IMDSv2

To maximize security, AWS recommends disabling IMDSv1 entirely and requiring IMDSv2. There are several ways to enforce this:

**At the Instance Level**

When launching an EC2 instance via the AWS Management Console, you can navigate to the "Advanced Details" section and find the "Metadata options" dropdown. You can set the HTTP endpoint to "Enabled (IMDSv2 only)" to require IMDSv2 for that instance.

Using the AWS CLI, you can achieve the same result:

```bash
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.micro \
  --metadata-options "HttpTokens=required,HttpPutResponseHopLimit=1"
```

The `HttpTokens=required` parameter enforces IMDSv2. The `HttpPutResponseHopLimit=1` parameter is a defense-in-depth setting that prevents the token from being accessible from child processes or external hosts (more on that in a moment).

**Modifying Existing Instances**

You can also modify the metadata options of a running instance:

```bash
aws ec2 modify-instance-metadata-options \
  --instance-id i-1234567890abcdef0 \
  --http-tokens required \
  --http-put-response-hop-limit 1
```

**At Scale with Launch Templates**

For production environments, you typically want to enforce this across all instances. Use an EC2 Launch Template to standardize metadata options:

```bash
aws ec2 create-launch-template \
  --launch-template-name my-secure-template \
  --launch-template-data '{
    "MetadataOptions": {
      "HttpTokens": "required",
      "HttpPutResponseHopLimit": 1
    }
  }'
```

Then, reference this template when launching instances via Auto Scaling Groups or other orchestration tools.

### Understanding HttpPutResponseHopLimit

The `HttpPutResponseHopLimit` parameter deserves a closer look. This setting controls how many network hops the metadata service response can traverse.

When set to `1` (the recommended value), the response can only reach the instance itself—it cannot be forwarded to a container, a child process, or another host on the network. When set to `2` or higher, the response can hop further, potentially reaching containerized applications or other processes.

For EC2 instances running containerized workloads (like Docker or Kubernetes), you need to be more careful. If you're running containers on EC2, you typically need to configure a bridge or proxy to provide metadata access to the containers, because the hop limit of `1` would prevent them from accessing the metadata service directly.

For standard EC2 instances running traditional applications, setting `HttpPutResponseHopLimit` to `1` is the secure default.

### Practical Implications for Developers

What does all this mean for you as a developer? Here are the key takeaways:

**Use IMDSv2 for new infrastructure.** When you're building new applications or infrastructure, enforce IMDSv2 from the start. The AWS SDKs support it seamlessly, and you avoid the SSRF risk entirely.

**Update your fallback assumptions.** If you maintain applications that directly interact with the metadata service (rather than relying on the SDK), ensure they support IMDSv2. This means implementing the two-step token acquisition process. For most developers, this is handled by the SDK, but custom credential providers or unusual deployment patterns might require manual implementation.

**Plan for containerized workloads carefully.** If you're running Docker or Kubernetes on EC2, understand that `HttpPutResponseHopLimit=1` might require additional configuration to allow containers to access the metadata service. Solutions include setting the hop limit to `2`, running a metadata proxy sidecar, or using alternative credential delivery mechanisms like `ExternalID` or `WebIdentityToken`.

**Audit your existing infrastructure.** Check your running instances and Auto Scaling Groups to see which are still using IMDSv1. Create a migration plan to enforce IMDSv2 across your fleet. This is typically a non-breaking change for applications using the AWS SDK, but always test in a non-production environment first.

**Monitor for SSRF vulnerabilities.** IMDSv2 is a strong defense against metadata service attacks, but it's not a substitute for secure coding practices. Continue to validate and sanitize user inputs, and avoid making HTTP requests to user-controlled URLs without careful validation.

### Troubleshooting Common Issues

If you enforce IMDSv2 and your application suddenly can't retrieve credentials, here are some common culprits:

**The application doesn't support IMDSv2.** Older versions of the AWS SDK might not support IMDSv2. Upgrade to a recent SDK version. This is rare in modern SDKs, but it can happen with legacy code.

**The application makes direct HTTP requests to the metadata service.** If your code manually constructs HTTP requests to `169.254.169.254`, you need to update it to use the token-based approach. The AWS SDK handles this, so refactoring to use the SDK is usually the simplest solution.

**Containers can't reach the metadata service.** If you're running containers with `HttpPutResponseHopLimit=1`, the container's HTTP requests to the metadata service will fail because the response can't reach the container. Solutions include increasing the hop limit, running a metadata proxy within the container host, or using alternative credential delivery mechanisms.

**IAM role or permissions issue.** Make sure the instance has an IAM instance profile attached with the necessary permissions. IMDSv2 will reject requests gracefully if permissions are missing, but the error message might be unclear.

### Moving Forward

IMDSv2 is the modern standard for EC2 metadata access. AWS has been encouraging adoption for years, and the security benefits are clear. If you're still running instances with IMDSv1, now is the time to plan your migration.

The good news is that this is largely a configuration change, not an application change. The AWS SDKs handle both versions transparently, so most applications continue working without modification. The security gains—reducing your exposure to SSRF attacks—are well worth the effort to enforce IMDSv2 across your infrastructure.

By understanding how the metadata service works, why IMDSv2 was introduced, and how to properly enforce it, you're taking an important step toward building more secure applications on AWS. The details matter, and in this case, understanding the details gives you both security and confidence in your infrastructure.
