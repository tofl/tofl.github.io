---
title: "CloudFront Cache Invalidation vs Versioned Filenames: Strategies for Cache Busting"
---

# CloudFront Cache Invalidation vs Versioned Filenames: Strategies for Cache Busting

When you deploy a new version of your website or application to AWS CloudFront, you face an immediate problem: the old version is still cached at edge locations around the world. Users might continue seeing outdated content for hours or even days, depending on your cache TTL settings. This is where cache busting strategies come in, and developers typically choose between two approaches: explicit cache invalidations or versioned filenames. Understanding when and how to use each approach is crucial for maintaining a smooth deployment workflow while controlling costs.

In this article, we'll explore both strategies in depth, examine their trade-offs, and show you how to implement them effectively in your CI/CD pipelines.

### Understanding CloudFront Caching Fundamentals

Before diving into cache busting strategies, let's clarify how CloudFront caches work. When a user requests a file from your CloudFront distribution, CloudFront checks whether that object exists in the edge location closest to the user. If it does and hasn't expired, the user gets that cached copy immediately. If not, CloudFront fetches the file from your origin (usually an S3 bucket or an application server) and caches it for future requests.

The cache duration is determined by the Cache-Control header and other caching headers returned by your origin. For example, if you set `Cache-Control: max-age=31536000` (one year), CloudFront will serve that exact object for a full year without checking your origin again. This is fantastic for performance and reducing origin load—until you need to deploy a new version.

The challenge is that CloudFront doesn't know a file has changed on your origin unless you explicitly tell it. Your origin might serve a completely new JavaScript bundle, but CloudFront still has the old one cached, and users keep downloading the stale version.

### Cache Invalidation: The Direct Approach

Cache invalidation is CloudFront's explicit mechanism for telling edge locations to discard cached objects immediately. When you create an invalidation request, you specify the paths you want to purge (like `/index.html` or `/assets/*`), and CloudFront propagates that invalidation across all edge locations globally. Within seconds to a few minutes, the old versions are removed from caches, forcing subsequent requests to fetch fresh content from your origin.

#### How Invalidation Costs Work

CloudFront offers a generous free tier: you get 1,000 invalidation paths per month at no charge. After that, each path costs $0.005 (half a cent). This might seem trivial, but it adds up quickly if you're invalidating aggressively.

A "path" in CloudFront's pricing model is a specific string you provide in your invalidation request. For example, if you create one invalidation with the paths `/index.html`, `/app.js`, and `/styles.css`, that counts as three paths toward your monthly allowance. If you use a wildcard like `/*`, that counts as a single path but invalidates everything matching that pattern.

Let's walk through a realistic scenario. Imagine you deploy your application five times per day, and each deployment invalidates 20 specific asset files plus `index.html`. That's 21 paths per deployment, or 105 paths daily. Over a 20-working-day month, you're at 2,100 paths—exceeding your free tier by 1,100 paths. At $0.005 per path, that's $5.50 per month in invalidation costs. For a small team, this might be acceptable. For a larger organization deploying frequently, costs can spiral quickly.

#### Invalidation Propagation and Behavior

When you submit an invalidation request via the AWS Management Console, AWS CLI, or SDK, CloudFront doesn't instantly remove objects from every edge location. Instead, it broadcasts the invalidation directive across its network of edge locations. Most invalidations propagate globally within 60 seconds, though CloudFront doesn't guarantee this timing. During the propagation window, some edge locations might still serve cached content while others already serve fresh content. This is rarely a problem in practice since users typically don't notice sub-minute differences, but it's worth knowing.

A practical example: you deploy a critical bug fix to your website and immediately create an invalidation for `/*` to purge everything. Within a minute, most users will see the fix. However, a user accessing from a distant edge location might still receive the old version for another 30 seconds. For most applications, this is acceptable. For real-time trading platforms or financial systems, you might need a different approach.

#### Wildcard Patterns and Their Pitfalls

Wildcard invalidations seem like a magic bullet. Why invalidate 50 specific paths when you can just use `/*` and clear everything at once? The answer is subtle but important.

First, using wildcards doesn't actually provide performance benefits over specific paths. CloudFront processes the wildcard and still needs to invalidate every object matching the pattern across every edge location. The cost is the same: one path, regardless of how many objects match.

Second, and more importantly, invalidating everything can have unintended consequences. Imagine you have a `robots.txt` file, a sitemap, or third-party dependencies that rarely change. If your deployment process invalidates `/*`, you're forcing edge locations to re-fetch these static resources even though they haven't changed. This increases origin load unnecessarily and slightly delays cache repopulation.

A better practice is to be surgical with your invalidations. If you only changed JavaScript and CSS files, invalidate `/assets/*` or list the specific files. If you changed just `index.html`, invalidate that single path. This keeps your path count low and avoids unnecessary origin requests.

#### Implementing Invalidations in Your CI/CD Pipeline

Creating an invalidation programmatically is straightforward using the AWS CLI or SDKs. Here's a practical example from a deployment script:

```bash
#!/bin/bash
set -e

# Deploy assets to S3
aws s3 sync ./dist s3://my-bucket/assets --delete

# Create CloudFront invalidation for specific paths
aws cloudfront create-invalidation \
  --distribution-id E1234ABCD \
  --paths /index.html /error.html /robots.txt \
  --region us-east-1

echo "Invalidation created successfully"
```

Or with Python using Boto3:

```python
import boto3

cloudfront = boto3.client('cloudfront')

response = cloudfront.create_invalidation(
    DistributionId='E1234ABCD',
    InvalidationBatch={
        'Paths': {
            'Quantity': 3,
            'Items': ['/index.html', '/error.html', '/sitemap.xml']
        },
        'CallerReference': str(int(time.time()))
    }
)

print(f"Invalidation created: {response['Invalidation']['Id']}")
```

The `CallerReference` parameter is a unique identifier for your invalidation request. CloudFront uses it to ensure idempotency—if you submit the same request twice with the same reference, it won't create duplicate invalidations.

### Versioned Filenames: The Smart Alternative

Instead of explicitly invalidating files, a more elegant approach is to embed a version identifier or content hash directly into the filename. For example, instead of serving `app.js`, you serve `app.abc123def.js`. When your code changes, the hash changes, producing a different filename. CloudFront treats it as a brand new object with no cached version, so it fetches the fresh content from your origin.

This approach has several profound advantages that make it the preferred long-term strategy for most organizations.

#### How Versioned Filenames Work

The core idea is simple: the filename itself becomes a cache key. CloudFront doesn't just use the path; it uses the entire path and query string as the cache key. By changing the filename when content changes, you create a new cache key, forcing a fresh fetch.

Consider a typical deployment flow with versioning:

1. Your build process (Webpack, Vite, etc.) outputs files with content hashes: `app.a1b2c3d4.js`, `styles.f5e6d7c8.css`
2. These files are uploaded to S3 with long cache TTLs (e.g., one year)
3. Your HTML file (`index.html`) references these versioned names
4. When you deploy a new version, the build produces different hashes: `app.x9y8z7w6.js`, `styles.v5u4t3s2.css`
5. The updated `index.html` is uploaded, referencing the new hashes
6. Users download the updated `index.html`, which points them to the new asset files
7. No invalidation needed—old cached files remain unused, new files are fetched fresh

The elegance here is that you only ever need to invalidate `index.html` (or whatever your entry point is). All other assets get unique filenames, so there's no need to bust their caches.

#### Automatic Hash Generation with Modern Tooling

You don't need to manually generate these hashes. Modern frontend build tools handle this automatically and have for years. Webpack, Vite, Parcel, and others all support content hashing out of the box.

Here's how to configure Webpack to generate versioned filenames:

```javascript
// webpack.config.js
module.exports = {
  mode: 'production',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'app.[contenthash:8].js',
    assetModuleFilename: 'assets/[hash:8][ext][query]'
  },
  // ... rest of config
};
```

The `[contenthash:8]` placeholder tells Webpack to use an 8-character hash of the file's content. If the file changes, the hash changes. The same file always produces the same hash, ensuring consistency.

With Vite, configuration is similarly straightforward:

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'app.[hash].js',
        chunkFileNames: 'chunk.[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]'
      }
    }
  }
})
```

When you run your build process, you get output like this:

```
dist/
├── index.html (not versioned, small, changes frequently)
├── app.a1b2c3d4.js (versioned, can be cached aggressively)
├── vendor.x9y8z7w6.js (versioned)
└── styles.f5e6d7c8.css (versioned)
```

#### Minimizing Invalidations with Versioning

The real cost savings emerge over time. With versioned filenames, you might only invalidate `index.html` (or your entry point) on each deployment. That's one path per deployment. Over a month with 100 deployments, you're well within the free 1,000-path tier, incurring zero invalidation costs.

Some teams take this a step further and use a service worker or manifest file to signal which assets are current, avoiding even an `index.html` invalidation. However, for most applications, invalidating just the HTML entry point is a reasonable compromise between simplicity and cost.

#### Setting Long Cache TTLs with Versioning

Here's where versioning truly shines: you can set extremely aggressive cache TTLs on versioned assets. With the invalidation approach, you're cautious about cache duration because invalidations might fail or propagate slowly. With versioning, you can confidently set `Cache-Control: max-age=31536000` (one year) on all versioned assets.

```javascript
// Example S3 deployment with aggressive caching
aws s3 sync ./dist s3://my-bucket \
  --exclude "index.html" \
  --cache-control "max-age=31536000,public" \
  --region us-east-1

# Upload index.html with shorter TTL
aws s3 cp ./dist/index.html s3://my-bucket/index.html \
  --cache-control "max-age=3600,public" \
  --content-type "text/html" \
  --region us-east-1
```

Long cache TTLs mean edge locations hold onto files for months or years, dramatically reducing origin load and serving static assets with near-zero latency from edge locations close to users worldwide. This is performance at scale.

#### Handling External Dependencies and CDN Resources

One wrinkle with versioning is external resources. If you reference a third-party library via a CDN URL (like a JavaScript library from a CDN), that URL doesn't change when your application deploys. The library is cached wherever it's hosted, not on your CloudFront distribution.

This is generally fine—you're only responsible for cache busting your own content. However, if you do decide to serve third-party libraries through your own CloudFront distribution (which can be beneficial for consolidating requests and improving control), those files should also be versioned or updated through invalidation.

### Practical Deployment Strategies: A Hybrid Approach

In practice, most mature applications use a combination of both strategies:

- **Versioned filenames for application assets**: JavaScript bundles, stylesheets, images, and other static resources get content hashes
- **Minimal invalidations for entry points**: Only the `index.html` (or similar entry point) gets invalidated on each deployment
- **Invalidation for special cases**: If you need to push a fix for a previously cached resource without redeploying everything, you have the option

This hybrid approach gives you the best of both worlds: aggressive caching and low costs for the majority of assets, plus the flexibility to invalidate quickly if needed.

### Real-World CI/CD Pipeline Examples

Let's look at practical deployment scripts that implement these strategies.

#### GitHub Actions Workflow with Versioning and Minimal Invalidation

```yaml
name: Deploy to CloudFront

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Build application
        run: |
          npm install
          npm run build
      
      - name: Deploy to S3
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_REGION: us-east-1
        run: |
          # Upload versioned assets with long cache TTL
          aws s3 sync ./dist s3://my-bucket \
            --exclude "index.html" \
            --cache-control "max-age=31536000,public" \
            --delete
          
          # Upload index.html with short cache TTL
          aws s3 cp ./dist/index.html s3://my-bucket/index.html \
            --cache-control "max-age=3600,public" \
            --content-type "text/html"
      
      - name: Invalidate CloudFront
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_REGION: us-east-1
        run: |
          aws cloudfront create-invalidation \
            --distribution-id ${{ secrets.CLOUDFRONT_DISTRIBUTION_ID }} \
            --paths "/index.html" \
            --region us-east-1
          
          echo "Deployment complete. Entry point invalidated."
```

#### GitLab CI Pipeline with Selective Invalidation Logic

```yaml
stages:
  - build
  - deploy
  - invalidate

variables:
  AWS_REGION: us-east-1
  S3_BUCKET: my-bucket
  DISTRIBUTION_ID: E1234ABCD

build:
  stage: build
  image: node:18
  script:
    - npm install
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 hour

deploy_s3:
  stage: deploy
  image: amazon/aws-cli:latest
  script:
    # Deploy versioned assets
    - aws s3 sync dist/ s3://${S3_BUCKET}/ 
        --exclude "index.html" 
        --cache-control "max-age=31536000,public"
        --delete
    
    # Deploy entry point with shorter TTL
    - aws s3 cp dist/index.html s3://${S3_BUCKET}/index.html
        --cache-control "max-age=3600,public"
        --content-type "text/html"
  dependencies:
    - build

invalidate_cloudfront:
  stage: invalidate
  image: amazon/aws-cli:latest
  script:
    - aws cloudfront create-invalidation
        --distribution-id ${DISTRIBUTION_ID}
        --paths "/index.html"
  dependencies: []
  only:
    - main
```

Notice how both examples focus invalidation on just `index.html`. This keeps path counts minimal and costs low while still ensuring users get the latest entry point and, through it, the latest versioned assets.

### Comparing the Two Strategies at Scale

Let's examine how these strategies perform at different scales of deployment frequency.

**Small team, occasional deployments (once per day)**

With invalidation-only: 1 invalidation per day × 20 working days = 20 paths per month. Well within the free tier.

Cost: $0. This works fine, though you'd want to be careful about cache TTLs to avoid stale content.

With versioning: ~1 path (index.html) per day × 20 days = 20 paths per month.

Cost: $0. Similar cost, but with the benefit of aggressive caching on assets.

**Medium team, several deployments daily (5 per day)**

With invalidation-only: Invalidating 10 paths per deployment × 5 deployments × 20 days = 1,000 paths per month.

Cost: $0 (exactly at the limit). As deployment frequency increases slightly, you start incurring costs.

With versioning: 1 path per deployment × 5 × 20 = 100 paths per month.

Cost: $0. You have room to grow before hitting limits.

**Large team, frequent releases (10+ per day)**

With invalidation-only: 10 paths × 10 deployments × 20 days = 2,000 paths per month.

Cost: $(2,000 - 1,000) × $0.005 = $5 per month, plus all invalidations add latency to deployments.

With versioning: 1 path × 10 × 20 = 200 paths per month.

Cost: $0. You're still comfortable, and deployments are faster since invalidations only wait for one path.

### Choosing Your Strategy

The decision between invalidation-based and versioning-based approaches depends on several factors:

**Use versioning if:**

Your team controls the build process and can implement content hashing. This is the case for almost all modern frontend applications. Versioning is the long-term strategy that scales best and provides the most aggressive caching. Once set up, it requires minimal ongoing thought.

**Use invalidation if:**

You're serving static content that doesn't go through a build process, or you're managing a large collection of media files where generating content hashes is impractical. You might also lean on invalidation during development or for rapid hotfixes where you don't want to rebuild the entire application.

**Use both if:**

You want maximum control. Implement versioning for your main assets but keep invalidation in your toolkit for emergency situations or files that don't fit the versioning model.

### Common Pitfalls and Solutions

**Pitfall 1: Invalidating everything on every deployment**

Using `/*` or invalidating hundreds of paths per deployment quickly exceeds free tier limits and defeats the purpose of aggressive caching. Solution: Be specific about what you invalidate. With versioning, invalidate only entry points.

**Pitfall 2: Setting overly short cache TTLs out of caution**

Some teams set `max-age=3600` (one hour) on all assets, thinking they need to invalidate frequently. This defeats the performance benefits of edge caching. Solution: Use versioning so you can confidently set year-long cache TTLs on versioned assets.

**Pitfall 3: Forgetting to update HTML references after deploying versioned assets**

You deploy `app.a1b2c3d4.js` to S3, but your `index.html` still references `app.js`. Users get a 404. Solution: Ensure your build tool generates both the hashed filename and updates all references. Test locally before deploying.

**Pitfall 4: Not accounting for invalidation propagation delays**

You deploy a fix, create an invalidation, and immediately test. An edge location near you already serves fresh content, so tests pass. But users far away still see the old version for another minute. Solution: Understand that invalidations take time to propagate. For critical fixes, monitor edge location behavior or use invalidation with monitoring.

**Pitfall 5: Mixing versioning strategies inconsistently**

Some files use hashes, others don't. This creates a confusing maintenance burden. Solution: Commit to one strategy per application. Either version everything (preferred) or invalidate everything, with the entry point exception.

### Monitoring and Validation

Regardless of which strategy you choose, monitoring is essential. CloudFront provides excellent metrics through CloudWatch:

```bash
# Check cache hit ratio
aws cloudwatch get-metric-statistics \
  --namespace AWS/CloudFront \
  --metric-name CacheHitRate \
  --dimensions Name=DistributionId,Value=E1234ABCD \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Average
```

A healthy distribution should have a cache hit rate above 80% for static assets. If your hit rate is below 70%, you might be invalidating too aggressively or setting cache TTLs too short.

You can also test invalidations work by using curl and checking response headers:

```bash
# Check cache status
curl -I https://example.com/assets/app.a1b2c3d4.js | grep -i x-cache

# Should show "Hit from cloudfront" after cache is populated
# Will show "Error from cloudfront" or "RefreshHit" immediately after invalidation
```

### Summary and Recommendations

Versioned filenames are the modern best practice for most web applications. They provide the best caching behavior, lowest invalidation costs, and simplest deployment workflow. Modern build tools make this approach nearly effortless—Webpack, Vite, and similar tools generate hashes automatically.

Start with versioning for all your static assets, keep HTML entry points on a short cache cycle (or invalidate them on deployment), and set long cache TTLs on everything else. This strategy scales beautifully from small projects to massive applications serving millions of users.

Reserve explicit cache invalidation for special cases: emergency hotfixes where you can't wait for a full rebuild, edge cases in your content that don't fit the versioning model, or rapid development iteration where convenience matters more than cost.

Understanding both approaches gives you the flexibility to handle any caching scenario CloudFront throws at you. As you grow from a single developer to a scaling operation, these strategies keep your deployments fast, your costs low, and your users happy.
