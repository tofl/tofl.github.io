---
title: "Hosting an HTTPS Static Website on S3 with CloudFront and ACM"
---

## Hosting an HTTPS Static Website on S3 with CloudFront and ACM

Building and deploying a static website has never been easier, yet the architecture behind a truly production-ready deployment involves several AWS services working in concert. Whether you're launching a single-page application built with React, Vue, or Angular, or simply hosting documentation and marketing content, the pattern of combining S3, CloudFront, and ACM has become the gold standard for secure, scalable, and performant static site delivery on AWS.

This pattern solves real problems that arise in production. You need HTTPS encryption for security. You need global content delivery to minimize latency for users around the world. You need to prevent direct access to your S3 bucket while allowing CloudFront to serve content. And if you're hosting a modern single-page application, you need intelligent routing to handle client-side navigation. By the end of this article, you'll understand each component of this architecture and be able to deploy a production-grade static website yourself.

### Understanding the Architecture

Before we dive into the configuration steps, let's establish why this particular architecture matters. A naive approach might involve uploading files directly to S3, enabling public access, and calling it done. This works for quick experiments but falls short in production because you lose the ability to enforce HTTPS, you can't cache content efficiently at the edge, and you have no control over access patterns.

The canonical pattern solves these issues by layering three key services. Amazon S3 serves as the origin—the persistent store for your website files. CloudFront acts as a content delivery network (CDN) and reverse proxy, caching content at edge locations around the globe and enforcing HTTPS. AWS Certificate Manager (ACM) provides the SSL/TLS certificate needed for HTTPS, managed automatically by AWS with no renewal hassles. Together, these services create a secure, fast, and globally distributed website.

The architecture also introduces a critical security improvement: Origin Access Control (OAC). This mechanism ensures that CloudFront is the only way to access your S3 bucket. Direct requests to the bucket are blocked by a bucket policy, forcing all traffic through CloudFront where you control caching, compression, and request headers.

### Step 1: Enable S3 Static Website Hosting

Start by creating an S3 bucket to store your website files. The bucket name doesn't need to match your domain anymore—that's actually a legacy requirement from the old S3 website hosting endpoint. Instead, choose a descriptive name that's globally unique.

```bash
aws s3api create-bucket \
  --bucket my-website-content \
  --region us-east-1
```

Once the bucket exists, enable static website hosting. This tells S3 to serve files as web content rather than downloadable objects. Navigate to the bucket settings in the AWS Console and go to the Static website hosting section, or use the CLI:

```bash
aws s3api put-bucket-website \
  --bucket my-website-content \
  --website-configuration '{
    "IndexDocument": {
      "Suffix": "index.html"
    },
    "ErrorDocument": {
      "Key": "error.html"
    }
  }'
```

The `IndexDocument` setting tells S3 which file to serve when someone requests a directory path (like `/` or `/about/`). The `ErrorDocument` is a fallback for 404 errors—though we'll refine this behavior later when dealing with single-page applications.

Upload your website files to this bucket. If you're working with a build system like webpack or npm, you'll typically upload the output of your build process. For example:

```bash
aws s3 sync ./dist s3://my-website-content/ --delete
```

At this point, your site is technically accessible via the S3 website endpoint (something like `http://my-website-content.s3-website-us-east-1.amazonaws.com`), but we're not done. The next steps add CloudFront in front of this bucket.

### Step 2: Request an SSL/TLS Certificate from ACM

CloudFront requires an SSL/TLS certificate to serve HTTPS traffic. AWS Certificate Manager makes this painless with free, auto-renewing certificates. Here's the critical detail: CloudFront only uses certificates issued in the `us-east-1` region, so you must request your certificate there regardless of where your S3 bucket lives.

Open the ACM console in the us-east-1 region and request a new certificate. You'll need to specify the domain name(s) you plan to use. If your website is `example.com` and you also want `www.example.com` to work, request both:

```
example.com
*.example.com
```

The wildcard covers not just `www` but any subdomain, which is useful if you later want to add things like `blog.example.com` or `api.example.com`.

AWS offers two validation methods: email validation and DNS validation. DNS validation is preferable because it's automated and doesn't require ongoing email access. With DNS validation, ACM provides you with a CNAME record that you add to your domain's DNS configuration. Once DNS propagates and AWS verifies the record, the certificate moves to an Issued state. This typically takes a few minutes to a few hours.

Once issued, note the certificate ARN—you'll need it when creating the CloudFront distribution.

### Step 3: Create a CloudFront Distribution

CloudFront is AWS's content delivery network. It caches your content at edge locations globally, automatically handles compression, and most importantly for our use case, it's where we enforce HTTPS and control access to your S3 bucket.

Creating a distribution requires careful configuration. You can do this through the console, but let's understand the key settings:

The origin is your S3 bucket. Specifically, use the S3 website endpoint (like `my-website-content.s3-website-us-east-1.amazonaws.com`), not the S3 API endpoint. This is crucial because the S3 website endpoint understands index documents and error responses, while the API endpoint does not.

For origin access, we'll use Origin Access Control (OAC). OAC is the modern, recommended approach that replaces the older Origin Access Identity (OAI). When you create an OAC, CloudFront generates a special AWS account ID that represents the distribution. You then use a bucket policy to allow *only* that account to access your bucket.

Here's a CloudFront distribution configuration in JSON format that captures the essential settings:

```json
{
  "CallerReference": "my-website-2024",
  "Comment": "Static website for example.com",
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [
      {
        "Id": "myS3Origin",
        "DomainName": "my-website-content.s3-website-us-east-1.amazonaws.com",
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "OriginProtocolPolicy": "http-only"
        },
        "OriginAccessControlId": "E127EXAMPLE51Z"
      }
    ]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "myS3Origin",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"]
    },
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true
  },
  "Enabled": true,
  "ViewerCertificate": {
    "AcmCertificateArn": "arn:aws:acm:us-east-1:123456789012:certificate/12345678-1234-1234-1234-123456789012",
    "SslSupportMethod": "sni-only",
    "MinimumProtocolVersion": "TLSv1.2_2021"
  },
  "Aliases": ["example.com", "www.example.com"]
}
```

The `ViewerProtocolPolicy` of `redirect-to-https` automatically sends HTTP traffic to HTTPS—a security best practice. The `CachePolicyId` references a managed cache policy; the one shown here is AWS's `CachingOptimized` policy, which is appropriate for static content.

The `Aliases` section defines which domain names CloudFront will accept. After creating the distribution, you'll point your DNS to CloudFront's domain name using these aliases.

Use the AWS CLI to create the distribution:

```bash
aws cloudfront create-distribution --distribution-config file://distribution-config.json
```

CloudFront returns a distribution ID and domain name. Copy the domain name; it looks something like `d111111abcdef8.cloudfront.net`.

### Step 4: Configure Origin Access Control and S3 Bucket Policy

Now that CloudFront is in place, we need to lock down the S3 bucket so that only CloudFront can access it. This is where Origin Access Control comes in.

If you created the OAC during distribution setup, you have an OAC ID. Now you need to attach a bucket policy that grants CloudFront's OAC permission to read objects:

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
      "Resource": "arn:aws:s3:::my-website-content/*",
      "Condition": {
        "StringEquals": {
          "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/E127EXAMPLE51Z"
        }
      }
    }
  ]
}
```

Replace the distribution ARN with your actual distribution ID. Apply this policy to the bucket:

```bash
aws s3api put-bucket-policy \
  --bucket my-website-content \
  --policy file://bucket-policy.json
```

After this, direct access to `my-website-content.s3-website-us-east-1.amazonaws.com` will be denied (you'll get a 403 Forbidden). Only requests coming through your CloudFront distribution are allowed. This is a crucial security boundary—it prevents someone from bypassing CloudFront and accessing your origin directly.

### Step 5: Configure Route 53 DNS Records

With CloudFront running and your certificate in place, the next step is to point your domain to the distribution. This is done through Route 53 (AWS's DNS service) or your existing DNS provider.

If using Route 53, create an alias record (also called an alias target) that points your domain to the CloudFront distribution. Alias records are AWS-specific and are free to use, unlike standard CNAME records which may incur charges. Here's how to create one:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456789ABC \
  --change-batch '{
    "Changes": [
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "example.com",
          "Type": "A",
          "AliasTarget": {
            "HostedZoneId": "Z2FDTNDATAQYW2",
            "DNSName": "d111111abcdef8.cloudfront.net",
            "EvaluateTargetHealth": false
          }
        }
      },
      {
        "Action": "CREATE",
        "ResourceRecordSet": {
          "Name": "www.example.com",
          "Type": "A",
          "AliasTarget": {
            "HostedZoneId": "Z2FDTNDATAQYW2",
            "DNSName": "d111111abcdef8.cloudfront.net",
            "EvaluateTargetHealth": false
          }
        }
      }
    ]
  }'
```

The `HostedZoneId` `Z2FDTNDATAQYW2` is a static value for CloudFront distributions—use it as-is. The `DNSName` is your CloudFront domain name. If you're not using Route 53, create a CNAME record at your existing DNS provider pointing both `example.com` and `www.example.com` to your CloudFront domain.

After DNS propagates (usually a few minutes), visiting `https://example.com` should serve your website with a valid SSL/TLS certificate.

### Step 6: Handle Single-Page Application Routing

Modern web applications built with React, Vue, or Angular rely on client-side routing. When a user visits `/about`, the server shouldn't look for a file at `/about/index.html`. Instead, it should serve `/index.html`, and the JavaScript application handles the routing on the client side.

The standard S3 behavior doesn't support this natively. Requests to `/about` result in a 403 or 404 because there's no `/about/index.html` file. We fix this with CloudFront's custom error responses feature.

In your CloudFront distribution settings, create a custom error response for 404 errors:

```json
{
  "ErrorCode": 404,
  "ResponseCode": "200",
  "ResponsePagePath": "/index.html",
  "ErrorCachingMinTTL": 0
}
```

This tells CloudFront: when S3 returns a 404 (because the file doesn't exist), serve `/index.html` instead but return a 200 status code. The application's JavaScript then takes over and handles the routing.

You can add the same rule for 403 errors, which occur when S3 can't find a path:

```json
{
  "ErrorCode": 403,
  "ResponseCode": "200",
  "ResponsePagePath": "/index.html",
  "ErrorCachingMinTTL": 0
}
```

Apply this configuration:

```bash
aws cloudfront create-invalidation \
  --distribution-id E127EXAMPLE51Z \
  --paths "/*"
```

Wait, that's an invalidation, not the error response. Let me show you the correct approach using the API:

```bash
aws cloudfront update-distribution \
  --id E127EXAMPLE51Z \
  --distribution-config file://distribution-config-with-errors.json
```

The distribution config file should include the `CustomErrorResponses` section. While this seems verbose, it's a one-time setup that handles all your SPA routing seamlessly.

One important note: the `ErrorCachingMinTTL` of 0 means CloudFront doesn't cache the 404-to-index.html redirect. This is intentional—you want fresh evaluations for paths that don't exist, so new routes added in future deployments are immediately available.

### Step 7: Implement Cache Invalidation in CI/CD

Cache invalidation is the final piece of the puzzle. When you deploy a new version of your website, CloudFront's edge caches still serve old files until their TTL (time-to-live) expires. For an active website, this can mean users see outdated content for hours.

The solution is to invalidate the cache immediately after deployment. This tells CloudFront to fetch fresh content from S3. Here's how you'd integrate this into a deployment pipeline:

```bash
aws cloudfront create-invalidation \
  --distribution-id E127EXAMPLE51Z \
  --paths "/*"
```

The `--paths "/*"` argument invalidates everything. For large sites or frequent deployments, you might prefer to invalidate only changed files:

```bash
aws cloudfront create-invalidation \
  --distribution-id E127EXAMPLE51Z \
  --paths "/index.html" "/js/app.abc123.js" "/css/style.def456.css"
```

Invalidations are processed quickly (usually within seconds), and CloudFront allows you to monitor the invalidation status:

```bash
aws cloudfront get-invalidation \
  --distribution-id E127EXAMPLE51Z \
  --id I1234567890ABC
```

In a typical CI/CD pipeline (using GitHub Actions, GitLab CI, or AWS CodePipeline), the deployment workflow looks like:

1. Build your static site (webpack, next.js build, etc.)
2. Sync the output to S3: `aws s3 sync ./dist s3://my-website-content/ --delete`
3. Invalidate CloudFront cache: `aws cloudfront create-invalidation --distribution-id ... --paths "/*"`
4. Monitor the invalidation until it completes

The `--delete` flag in the S3 sync command is important—it removes files from S3 that are no longer in your build output, preventing stale files from lingering in CloudFront's cache.

### Caching Strategy and Performance Tuning

Beyond the basic setup, understanding cache behavior optimizes your site's performance. CloudFront uses cache headers to determine how long to store content. For static files with content hashes in their names (like `app.abc123.js`), you can safely cache for years. For `index.html`, which changes with each deployment, shorter caching or no caching is appropriate.

You can control this per file type using CloudFront cache behaviors. For example, add a specific behavior for `index.html`:

```json
{
  "PathPattern": "/index.html",
  "TargetOriginId": "myS3Origin",
  "ViewerProtocolPolicy": "redirect-to-https",
  "AllowedMethods": {
    "Quantity": 2,
    "Items": ["GET", "HEAD"]
  },
  "CachePolicyId": "4135ea3d-c35d-46eb-81d7-reeSodeXjd7",
  "Compress": true
}
```

The cache policy ID `4135ea3d-c35d-46eb-81d7-reeSodeXjd7` is AWS's `CachingDisabled` managed policy, meaning CloudFront always fetches fresh index.html from S3. This ensures users get the latest version without waiting for invalidation to complete.

Compression is enabled by default in the recommended cache policies, which significantly reduces transfer sizes for text-based assets like HTML, CSS, and JavaScript.

### Monitoring and Troubleshooting

As your site goes live, monitoring ensures everything works as expected. CloudFront provides CloudWatch metrics showing request volume, error rates, and cache hit ratios. A healthy distribution typically has a cache hit ratio above 80%, meaning CloudFront serves most content from cache.

If you notice a low hit ratio, it might indicate:

Cache policies that are too aggressive. If you're setting very short TTLs, requests expire quickly and CloudFront has to refetch from S3 frequently.

Misconfigured custom error responses. If 404 handling isn't working, users see error pages instead of your application, which suggests the error response path or status code is incorrect.

Distribution not yet deployed. After creating a distribution, it takes a few minutes for all edge locations to sync the configuration. Check the deployment status in the CloudFront console.

For debugging, CloudFront includes helpful headers in responses. The `X-Cache` header shows whether a request hit the cache, and `X-Amz-Cf-Id` identifies the specific edge location. These headers are invaluable when troubleshooting.

Also monitor your S3 bucket for unexpected costs. While S3 data transfer to CloudFront is free, large numbers of small files can increase request charges. Using CloudFront's cache effectively minimizes origin requests and keeps costs low.

### Security Considerations

This architecture provides several security benefits out of the box. HTTPS encryption in transit protects user data. The OAC bucket policy prevents direct S3 access, eliminating a potential attack vector. CloudFront also supports additional security features worth considering:

Origin Shield adds an extra caching layer between edge locations and your origin, reducing load spikes. If your site becomes popular unexpectedly, Origin Shield prevents a "cache stampede" where a cache miss floods your S3 bucket.

Web Application Firewall (WAF) integration allows you to block malicious requests before they reach CloudFront, protecting against common attacks like SQL injection or cross-site scripting (XSS).

For sensitive sites, you can require specific HTTP security headers (like Strict-Transport-Security) using CloudFront's response headers policies, which is simpler than modifying your S3 website configuration.

### Conclusion

Hosting a static website on AWS using S3, CloudFront, and ACM is a well-established pattern that delivers security, performance, and reliability. The combination ensures global content delivery through CloudFront's edge network, enforces HTTPS with auto-renewing certificates from ACM, and keeps your S3 bucket secure using Origin Access Control. For single-page applications, custom error responses handle client-side routing transparently. Cache invalidation in CI/CD pipelines ensures users always see the latest content without delay.

This architecture scales effortlessly—whether you're serving thousands or millions of requests daily, CloudFront transparently handles the load, and you pay only for what you use. Once configured, the setup requires minimal ongoing maintenance beyond deploying updates and monitoring performance.

As you implement this pattern, keep in mind the interplay between each component. CloudFront's caching is powerful only if you configure appropriate cache policies. SPA routing only works with the right custom error responses. Deployments only stay current if you invalidate the cache. Each piece depends on the others, and understanding these dependencies ensures your static website operates smoothly in production.
