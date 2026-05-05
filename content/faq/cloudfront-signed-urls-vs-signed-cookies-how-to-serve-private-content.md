---
title: "CloudFront Signed URLs vs Signed Cookies: How to Serve Private Content"
---

## CloudFront Signed URLs vs Signed Cookies: How to Serve Private Content

Imagine you've built a video streaming platform where users pay for premium content. Your media library is hosted on Amazon S3 and distributed globally through CloudFront, but you absolutely cannot allow unauthenticated visitors to access your videos by simply guessing the URL. This is where CloudFront's access control mechanisms become critical. You need to restrict content delivery to authenticated users only, and you need to do it efficiently across your global infrastructure.

CloudFront offers two powerful mechanisms for protecting private content: signed URLs and signed cookies. While they share the same underlying cryptographic foundation, they solve different problems. Understanding when and how to use each is essential for building secure, scalable applications on AWS.

### Understanding CloudFront Access Control Basics

Before diving into signed URLs and cookies, let's establish the foundation. CloudFront is a content delivery network that caches and serves content from edge locations around the world. By default, everything you serve through CloudFront is publicly accessible—anyone with the URL can retrieve it. For private content, you need to restrict access at the CloudFront level.

There are several ways to protect content in CloudFront. You can use Origin Access Control (OAC) to prevent direct access to your S3 bucket while allowing CloudFront to access it—but this protects the bucket, not individual files. You can also use AWS Web Application Firewall (WAF) to block traffic based on IP addresses or request patterns. However, when you need to grant access to specific individuals or sessions for specific files or sets of files, signed URLs and signed cookies are your tools.

Both mechanisms work by cryptographically signing a request. CloudFront validates this signature before serving the content. If the signature is invalid, expired, or missing, CloudFront returns a 403 Forbidden error. The signing happens on your origin server (or in your application backend) using a private key, and CloudFront validates it using the corresponding public key.

### Signed URLs: Granular Control for Individual Access

A signed URL is a complete, self-contained URL that includes authentication parameters embedded directly in the query string. When you sign a URL, you're cryptographically binding access parameters—like the file path, expiration time, and optional IP restrictions—directly into the URL itself.

Think of a signed URL like a timestamped, cryptographically sealed ticket to a specific movie. The ticket includes the exact movie (file), the date and time it expires, and optionally, restrictions like "only valid from this theater's IP address." Once you hand that ticket to someone, it's a complete, independent credential.

Signed URLs are ideal when you need to grant access to a single file or a small set of specific files to individual users. Common use cases include generating download links that expire after a few hours, allowing users to stream specific video files, or creating shareable links for temporary access without requiring authentication.

Here's a practical example: a user purchases a PDF report on your website. Your backend generates a signed URL that's valid for 24 hours and sends it to the user's email. The user can click that link and download the file directly from CloudFront without any additional authentication. After 24 hours, the URL expires and becomes useless.

Another powerful aspect of signed URLs is that each URL can have completely independent access parameters. You can create one URL valid for 1 hour with IP restrictions for a specific corporate network, and another URL valid for 7 days with no IP restrictions for a mobile user. This granularity is crucial for scenarios where you need fine-grained control.

### Signed Cookies: Transparent Access to Multiple Files

Signed cookies work differently. Instead of embedding authentication into the URL, you set an HTTP cookie on the user's browser. CloudFront checks for the presence and validity of this cookie before serving any content. A single signed cookie can grant access to multiple files—even an entire directory or all content matching a URL pattern.

Think of a signed cookie like a visitor badge at a corporate office. Once a visitor receives the badge, they can access any area of the office that the badge authorizes, without needing a separate credential for each room. They simply walk through any door, and security checks the badge.

Signed cookies are perfect for scenarios where users need access to multiple files or where you want to keep the URL structure clean and untouched. The classic use case is a subscription video platform where a logged-in user should be able to browse and play any video in their subscription tier. You set a signed cookie on login, and every subsequent request—whether it's for video A, video B, or the thumbnail for video C—is automatically authorized without modifying any URLs.

Signed cookies are also more transparent to your application. URLs remain human-readable and SEO-friendly, without query string parameters cluttering the address bar. If a user bookmarks a video URL, the bookmark itself is meaningless without the cookie, but from the user's perspective, they just click the bookmark and it works (assuming they're still logged in and the cookie hasn't expired).

### Key Pairs vs Key Groups: A Critical Distinction

AWS provides two mechanisms for managing the keys that sign and verify CloudFront content: key pairs and key groups. Understanding the difference is crucial because it affects how you manage key rotation and team access.

**Key Pairs** are the older approach. You create a key pair in the AWS Console, download the private key (which you must store securely), and use it to sign content. The public key is automatically associated with your AWS account. The problem with key pairs is that they're account-level credentials, and you can only have a small number of them (default limit is 2). If you need to rotate keys or distribute signing capabilities across different teams or services, key pairs become cumbersome.

**Key Groups** are the modern, recommended approach. A key group is a container of public keys that you explicitly associate with your CloudFront distribution. You can create multiple key groups, add multiple public keys to each group, and activate or deactivate groups independently. Key groups support key rotation seamlessly—you can add a new public key to a group while the old one is still active, allowing a smooth transition period. Key groups also scale better for organizations with multiple signing services or teams.

When you create a distribution or update a distribution's trusted signers, you now use key groups rather than key pairs. If you're working with older AWS documentation or code that mentions key pairs, understand that the same underlying mechanisms apply, but key groups are the path forward.

### Policy Structures: Canned vs Custom

When you sign a URL or cookie, you're attaching a policy document to it. The policy specifies what's being authorized: which files can be accessed, when access expires, and optionally, what IP addresses are allowed. AWS provides two policy formats.

**Canned policies** are simpler. You specify just the resource path and an expiration time. CloudFront applies a standard policy template. Canned policies are quick to implement and perfect for most common scenarios. Here's conceptually what a canned policy includes: the resource path (what file or pattern of files), the expiration timestamp, and that's it.

**Custom policies** give you full control over the policy document itself. With a custom policy, you can add IP address restrictions, restrict to specific date ranges (not just expiration), specify a starting date in the future, and include other conditions. Custom policies are slightly more complex to generate, but they're essential when you need fine-grained control.

Consider this scenario: you're hosting a product launch event and want to distribute a preview video to select partners. You want the video accessible only from their corporate IP ranges, starting at 6 AM on launch day, and expiring at midnight. A canned policy can't express that—you need a custom policy with IP restrictions and specific date boundaries.

The policy itself is JSON, and when you sign content, you're signing this JSON document. The signature, the policy, and the key ID (identifying which public key to use for verification) are all sent with the request, either as URL parameters or as cookie values.

### Generating Signed URLs and Cookies with the AWS SDK

Now let's move into the practical realm and see how to actually generate signed URLs and cookies using the AWS SDKs.

The AWS SDK abstracts away much of the cryptographic complexity. You don't manually sign JSON or construct the policy—the SDK handles it. Here's a Node.js example using the AWS SDK v3:

```javascript
import { CloudFrontSigner } from "@aws-sdk/cloudfront-signer";
import * as fs from "fs";

// Load your private key (from AWS)
const privateKeyString = fs.readFileSync("pk-APKABC123.pem", "utf-8");

// Create a signer
const signer = new CloudFrontSigner({
  keyPairId: "APKABC123",
  privateKey: privateKeyString,
});

// Generate a canned signed URL
const url = signer.getSignedUrl({
  url: "https://d123.cloudfront.net/videos/premium.mp4",
  dateLessThan: new Date(Date.now() + 3600000), // Valid for 1 hour
});

console.log(url);
// Output: https://d123.cloudfront.net/videos/premium.mp4?Policy=eyJ...&Signature=abc...&Key-Pair-Id=APKABC123
```

This generates a complete signed URL. The URL includes three query parameters: `Policy` (base64-encoded), `Signature`, and `Key-Pair-Id`. CloudFront decodes and validates these parameters on every request.

For a custom policy with IP restrictions, it's slightly more involved:

```javascript
const signedUrl = signer.getSignedUrl({
  url: "https://d123.cloudfront.net/reports/annual-summary.pdf",
  dateLessThan: new Date(Date.now() + 86400000), // 24 hours
  ipAddress: "203.0.113.0/24", // Only accessible from this CIDR block
});
```

Now let's look at generating a signed cookie. The approach is similar, but the output is different—instead of a URL, you get cookie attributes:

```javascript
const cookieParams = signer.getSignedCookie({
  url: "https://d123.cloudfront.net/videos/*", // Pattern matching all videos
  dateLessThan: new Date(Date.now() + 604800000), // 7 days
});

// cookieParams returns an object like:
// {
//   "CloudFront-Policy": "eyJ...",
//   "CloudFront-Signature": "abc...",
//   "CloudFront-Key-Pair-Id": "APKABC123"
// }

// In your HTTP response, set these as cookies
response.cookie("CloudFront-Policy", cookieParams["CloudFront-Policy"], {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
});
response.cookie(
  "CloudFront-Signature",
  cookieParams["CloudFront-Signature"],
  { httpOnly: true, secure: true, sameSite: "Lax" }
);
response.cookie("CloudFront-Key-Pair-Id", cookieParams["CloudFront-Key-Pair-Id"], {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
});
```

The same logic applies in Python using the AWS SDK:

```python
from botocore.signers import CloudFrontSigner
import json
from datetime import datetime, timedelta

# Load private key
with open("pk-APKABC123.pem", "r") as f:
    private_key = f.read()

# Create a signer
def rsa_signer(message):
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives import serialization

    key = serialization.load_pem_private_key(
        private_key.encode("utf-8"), password=None, backend=default_backend()
    )
    return key.sign(message, padding.PKCS1v15(), hashes.SHA1())

signer = CloudFrontSigner("APKABC123", rsa_signer)

# Generate signed URL
url = signer.generate_presigned_url(
    "https://d123.cloudfront.net/videos/premium.mp4",
    date_less_than=datetime.utcnow() + timedelta(hours=1),
)

print(url)
```

The principle is identical across languages: you provide the resource URL, expiration, and optional restrictions, and the SDK generates a cryptographically signed credential.

### Distribution Configuration: Setting Up Trusted Signers

Before your signed URLs and cookies work, you need to configure your CloudFront distribution to trust the key group that will sign the content. This is a distribution-level setting.

When you create or update a distribution, you specify the "Trusted Signers" or "Trusted Key Groups" in the behavior settings. You select the key group that contains the public keys you're using to sign. CloudFront then validates all signatures against the public keys in that group.

Here's the important part: if you don't configure a trusted key group, CloudFront won't validate signatures at all—it will serve the content to anyone. So forgetting this step is a common mistake that leaves your content unprotected.

You also need to ensure that the distribution requires signatures for the relevant resources. In the distribution's cache behaviors, you can configure whether signed content is required for specific path patterns. For example, you might require signatures for `/videos/*` and `/reports/*`, but allow public access to `/public/*`.

### Understanding Policy Documents in Detail

Let's demystify what's actually in a policy document, because understanding this helps you debug issues and make informed decisions about what restrictions you need.

A canned policy is simple. When you specify a URL and expiration, the SDK generates something like this behind the scenes:

```json
{
  "Statement": [
    {
      "Resource": "https://d123.cloudfront.net/videos/premium.mp4",
      "Condition": {
        "DateLessThan": {
          "AWS:EpochTime": 1700000000
        }
      }
    }
  ]
}
```

This policy says: "This resource can be accessed until epoch time 1700000000." That's it.

A custom policy is more expressive:

```json
{
  "Statement": [
    {
      "Resource": "https://d123.cloudfront.net/videos/*",
      "Condition": {
        "DateGreaterThan": {
          "AWS:EpochTime": 1699900000
        },
        "DateLessThan": {
          "AWS:EpochTime": 1700100000
        },
        "IpAddress": {
          "AWS:SourceIp": "203.0.113.0/24"
        }
      }
    }
  ]
}
```

This policy is far more restrictive: access to any video, but only starting at epoch 1699900000, ending at epoch 1700100000, and only from the IP range 203.0.113.0/24. If a request violates any of these conditions, CloudFront rejects it.

The policy is Base64-encoded when transmitted in URLs or cookies. When you see `Policy=eyJTdGF0ZW1lbnQiOlt7...` in a signed URL, that's the Base64-encoded JSON policy.

### Common Troubleshooting: Why You're Getting 403 Errors

You've generated signed URLs, configured your distribution, and the user is still getting a 403 Forbidden error. This is frustrating, but the causes are usually straightforward.

**The signature doesn't match.** This typically happens if the URL or policy was modified after signing, or if the key ID doesn't correspond to a key in the trusted key group. Verify that you're using the correct key pair ID and that the distribution trusts the key group containing that key.

**The URL has expired.** Check your system time. If the server generating signatures has a clock skewed significantly from UTC, all your signatures will be immediately expired. Ensure your servers use NTP for time synchronization.

**The IP restriction is too narrow.** If you've added an IP restriction to the policy, verify that the request is actually coming from that IP. Corporate networks with NAT might have multiple exit points. If you're testing locally and added a restrictive IP, the request will be rejected.

**The distribution isn't configured to require signatures.** Double-check the distribution settings. The cache behavior for the resource path must have a trusted key group configured. If you select "No trusted signers," CloudFront doesn't validate signatures.

**The resource path in the policy doesn't match the request.** Signed URLs are for specific resources. If your policy specifies `/videos/movie1.mp4` but the request is for `/videos/movie2.mp4`, the signature is invalid. This matters less with wildcard resources like `/videos/*`, but exact paths are unforgiving.

**You're using an old key.** If you've rotated keys and removed the old public key from the key group, URLs signed with the old key will fail. Ensure that during key rotation, you keep the old key active long enough for existing URLs to expire.

A useful debugging approach is to decode the Base64 policy from your signed URL and verify it matches your expectations. You can Base64-decode the policy and check the Resource field, the Condition fields, and the expiration time. Many online Base64 decoders work for this purpose, though you should never decode and transmit signing keys or sensitive policies over the internet.

### Signed URLs vs Signed Cookies: Decision Matrix

So when do you use signed URLs, and when do you use signed cookies? Let's break it down by scenario.

Use **signed URLs** when you need to grant access to specific files to specific individuals, especially when those individuals might not have an active session. Signed URLs are self-contained—the user receives a URL, and that URL alone is sufficient to access the resource. This is perfect for email-based sharing, temporary download links, or API-driven access control where you don't control the client's cookies.

Signed URLs are also better when you want to control access at the file level and provide different expiration times for different users. If User A should have access for 1 hour and User B for 7 days, you generate two different URLs with different policies.

Use **signed cookies** when you have an authenticated user session and want to grant that user (or that session) access to multiple resources. Cookies are transparent—the user doesn't see authentication parameters in the URL. This is ideal for web applications where users log in, and you want every subsequent request to be automatically authorized.

Signed cookies are also more user-friendly for bookmarking and sharing URLs. When a user bookmarks `https://d123.cloudfront.net/videos/episode-42.mp4`, they bookmark a clean URL. If they later access the bookmark (and the cookie is still valid), it works without them realizing they're using signed cookies.

A hybrid approach is common: use signed cookies for your primary web application (where users log in and browse), and use signed URLs for APIs, webhooks, or scenarios where you're sharing access outside of a traditional session.

### Key Rotation and Operational Considerations

As your application matures, you'll eventually need to rotate keys. This might be due to security concerns, policy requirements, or routine maintenance.

The process is straightforward with key groups. First, you generate a new key pair in AWS. Then, you add the new public key to the existing key group. At this point, both old and new keys are trusted. You update your signing code to use the new private key for all new signatures. Existing URLs and cookies signed with the old key remain valid until they expire. After a grace period (long enough for all old signatures to expire), you remove the old public key from the key group.

This approach avoids forcing all users to re-authenticate or invalidating existing URLs mid-stream. It's a graceful transition.

For key pairs (the older mechanism), rotation is more disruptive because you can only have a small number of them. Key groups were designed to solve this problem.

Another operational consideration is logging and monitoring. CloudFront Access Logs include information about signed requests, including whether they were authorized or rejected. Set up CloudWatch alarms to monitor the rate of 403 errors on your signed content. A sudden spike might indicate that users' cookies have expired, that there's a clock skew issue, or that someone is attempting to use tampered URLs.

### Real-World Implementation: A Subscription Video Platform

Let's tie this together with a concrete example. Imagine you're building the backend for a subscription video platform. Users log in, browse a catalog of videos, and click to watch.

When a user logs in, your backend creates a session and sets a signed cookie valid for 30 days:

```javascript
app.post("/login", (req, res) => {
  // Authenticate user
  const user = authenticateUser(req.body.username, req.body.password);
  if (!user) {
    return res.status(401).send("Invalid credentials");
  }

  // Create signed cookie allowing access to all subscription content
  const cookieParams = signer.getSignedCookie({
    url: "https://d123.cloudfront.net/videos/*",
    dateLessThan: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });

  // Set cookies
  Object.keys(cookieParams).forEach((key) => {
    res.cookie(key, cookieParams[key], {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
  });

  res.send({ success: true, userId: user.id });
});
```

Now, when the user's browser makes requests to any video on CloudFront, the cookies are automatically included. CloudFront validates them and serves the video. The user never sees authentication parameters in the URL.

For an API client that needs to download multiple videos in batch, you'd use signed URLs instead:

```javascript
app.get("/api/download-urls", (req, res) => {
  // Assume user is authenticated via JWT
  const videos = req.query.videoIds.split(",");
  const urls = videos.map((videoId) =>
    signer.getSignedUrl({
      url: `https://d123.cloudfront.net/videos/${videoId}.mp4`,
      dateLessThan: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hour validity
    })
  );

  res.json({ downloadUrls: urls });
});
```

The API returns a list of signed URLs. The client can download each video using these URLs without needing to maintain session state or cookies.

### Summary and Next Steps

CloudFront signed URLs and signed cookies are powerful tools for controlling access to private content. Signed URLs provide granular, per-file control and are ideal for sharing or API-driven access. Signed cookies are transparent to the URL structure and perfect for session-based access to multiple resources.

The underlying mechanisms are identical: cryptographic signing of a policy document that specifies what's authorized and under what conditions. Understanding policy structures, key management, and the difference between key pairs and key groups is essential for building secure applications.

The AWS SDKs make implementation straightforward, abstracting the cryptographic complexity. But remember to configure your distributions correctly with trusted key groups, monitor for 403 errors, and plan for key rotation.

Start with signed cookies for your primary web application if you have session-based authentication. Layer in signed URLs for APIs or external sharing. As your platform scales and your access control requirements become more sophisticated, you'll find these mechanisms adapt well. Combine them with Origin Access Control for bucket protection, AWS WAF for additional request filtering, and you've built a comprehensive content protection strategy.
