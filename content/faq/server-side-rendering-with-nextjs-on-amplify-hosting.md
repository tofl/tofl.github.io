---
title: "Server-Side Rendering with Next.js on Amplify Hosting"
---

## Server-Side Rendering with Next.js on Amplify Hosting

Deploying a Next.js application to AWS can feel like standing at a crossroads. You could push everything to S3 and CloudFront, but that limits you to static site generation. You could provision EC2 instances, but that introduces operational overhead. Or you could use AWS Amplify Hosting, which abstracts away much of that complexity while giving you the full power of Next.js's server-side rendering capabilities. This guide walks you through how to deploy and optimize server-side rendered Next.js applications on Amplify, covering everything from build configuration to runtime behavior.

### Understanding Next.js Rendering Models

Before diving into deployment specifics, it helps to understand what Next.js actually offers and why rendering strategy matters. Next.js gives you several ways to generate content: static site generation (SSG) for pages that rarely change, incremental static regeneration (ISR) for pages that need occasional updates, server-side rendering (SSR) for truly dynamic content, and API routes for serverless backend functions. Amplify Hosting supports all of these patterns, but they're handled differently depending on how your application is configured.

When you use SSR in Next.js, pages are rendered on demand when a user requests them. This means you can access request-specific data—headers, query parameters, user context—and generate the HTML response dynamically. ISR combines the best of both worlds: pages are pre-rendered at build time, but they're automatically regenerated in the background after a certain period or when explicitly revalidated. API routes become Lambda functions that handle backend logic without needing a separate server.

The real power emerges when you understand that Amplify doesn't treat your Next.js app as a monolithic application. Instead, it intelligently separates concerns. Static pages (whether pre-rendered or not) are served from CloudFront. Dynamic routes and API endpoints are routed to serverless compute. This hybrid approach gives you the speed of a CDN with the flexibility of backend logic.

### How Amplify Hosting Handles Next.js Deployments

When you connect a Next.js repository to Amplify Hosting, the platform analyzes your configuration and automatically detects it as a Next.js project. During the build phase, Amplify runs the Next.js build command, which generates a `.next` directory containing optimized assets, pre-rendered pages, and function manifests. This is where things get interesting: Amplify then translates Next.js functions into AWS Lambda functions. Specifically, pages that require server-side rendering become Lambda functions that are either invoked directly or through Lambda@Edge, depending on the scenario.

For routes that are statically generated at build time, Amplify serves them directly from CloudFront. These pages benefit from edge caching and have minimal latency. Pages configured for ISR are similar—they're pre-rendered and cached, but the revalidation mechanism triggers a Lambda function to regenerate them in the background. API routes and dynamic SSR pages become Lambda functions that are triggered on-demand. The beauty of this setup is that you don't manually manage any of this infrastructure; Amplify handles the translation automatically.

Lambda@Edge comes into play for certain scenarios. If your Next.js application has middleware or needs request/response manipulation at the edge, Amplify can provision Lambda@Edge functions that execute closer to your users, reducing latency. This is particularly valuable for authentication checks, custom headers, or URL rewrites that need to happen before the request reaches origin Lambda functions.

### Supported Next.js Features on Amplify

Amplify Hosting has excellent support for core Next.js features, but it's worth understanding which ones work seamlessly and which require special configuration. **Server-side rendering** is fully supported. Any page with `getServerSideProps` becomes a Lambda function that executes on request, giving you access to the full request context. **Incremental Static Regeneration** works beautifully on Amplify. Pages with `getStaticProps` and a `revalidate` value are pre-rendered at build time, cached globally, and regenerated on a schedule or on-demand.

**Image Optimization** through Next.js's `Image` component is supported, and Amplify integrates with CloudFront to cache optimized images. The `next/image` component automatically generates responsive images, and Amplify ensures they're delivered efficiently. **API Routes** become Lambda functions with generous execution time, so even computationally intensive operations complete within typical request windows. **Dynamic Routes** and **Catch-All Routes** work as expected, with Amplify intelligently routing them to the appropriate Lambda function.

There are a few features that require attention. **Streaming responses** are supported, but there's a practical limit based on Lambda timeout constraints. **Middleware** (the `middleware.ts` file) runs on Lambda@Edge if configured, allowing you to intercept requests globally. **Font optimization** and **script optimization** work out of the box since they're handled at build time.

What doesn't work? Anything requiring long-running processes. If your application needs background jobs lasting hours, you'll want to decouple that logic into Step Functions, SQS, or SNS rather than relying on Lambda's execution time limits. Similarly, server-side file uploads might need special handling since Lambda functions have temporary storage limitations.

### Configuring the Build Process with amplify.yml

The heart of your deployment configuration lives in the `amplify.yml` file in your repository root. This YAML file tells Amplify exactly how to build your Next.js application and how to handle different routes. If you don't provide one, Amplify uses intelligent defaults—but you'll almost always want to customize it for your specific needs.

Here's a minimal but practical `amplify.yml` for a Next.js application:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

This configuration tells Amplify to install dependencies using `npm ci` (which is preferred for CI/CD over `npm install` due to its deterministic nature), run the build command, and treat the `.next` directory as the output. The cache configuration speeds up subsequent builds by retaining `node_modules`.

However, a more sophisticated configuration might look like this:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
        - echo "Environment setup complete"
    build:
      commands:
        - npm run build
        - echo "Build completed at $(date)"
    postBuild:
      commands:
        - echo "Running post-build validations"
  artifacts:
    baseDirectory: .next
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
  envScript: envVars.sh
```

The `postBuild` phase lets you run tests or validation after building but before deployment. The `envScript` option can dynamically generate environment variables during the build, though we'll cover environment variables more thoroughly in the next section.

### Managing Environment Variables and Secrets

Environment variables in Amplify Hosting come in two flavors: build-time variables and runtime variables. Build-time variables are available during the build process and get baked into your application bundle. Runtime variables are available only to Lambda functions at execution time. Understanding this distinction is crucial because it affects security and flexibility.

Build-time environment variables are set in the Amplify console under "Environment variables." Any variable you set here is injected into the build environment and is accessible to your Next.js build process. This is appropriate for non-sensitive configuration like feature flags or API endpoints that are okay to expose in your client-side bundle. If you're using environment variables in your `getStaticProps` or at build time, they need to be set here.

For sensitive data—API keys, database credentials, OAuth secrets—you should use Amplify's secrets manager or AWS Secrets Manager. When you store a secret in Amplify, it's encrypted and never exposed in logs. You can reference it in your functions without it appearing in your deployed code. However, here's the critical detail: **secrets are not available during build time**. If you need them, you must fetch them at runtime from your API routes or server-side props.

Here's a practical example. Imagine you have a public API endpoint that requires an API key. During build time, you might not have the key, so you can't bake it in. Instead, you fetch it at runtime:

```javascript
export async function getServerSideProps(context) {
  const apiKey = process.env.EXTERNAL_API_KEY;
  
  if (!apiKey) {
    return {
      notFound: true,
    };
  }

  const response = await fetch('https://api.example.com/data', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  const data = await response.json();

  return {
    props: { data },
    revalidate: 60,
  };
}
```

When this runs on Lambda, `process.env.EXTERNAL_API_KEY` is populated from Amplify's environment configuration at execution time.

For build-time variables that should be client-accessible, you use the `NEXT_PUBLIC_` prefix:

```
NEXT_PUBLIC_API_ENDPOINT=https://api.example.com
NEXT_PUBLIC_APP_VERSION=1.0.0
```

These variables are baked into your JavaScript bundle and accessible in the browser. Never use this pattern for sensitive data.

### Custom Headers, Rewrites, and Route Configuration

One of Amplify's most powerful features is the ability to define custom headers and rewrites directly in your configuration. These are handled by CloudFront and Lambda@Edge, meaning they execute with minimal latency. The configuration lives in a `next.config.js` file, which is where Next.js projects already define custom behavior.

Here's an example `next.config.js` that demonstrates custom headers and rewrites:

```javascript
const nextConfig = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'X-Custom-Header',
            value: 'MyCustomValue',
          },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },

  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/docs',
          destination: '/documentation',
        },
      ],
      afterFiles: [
        {
          source: '/api/:path*',
          destination: 'https://api.example.com/:path*',
        },
      ],
      fallback: [
        {
          source: '/:path*',
          destination: `/404`,
        },
      ],
    };
  },
};

module.exports = nextConfig;
```

The `headers` function lets you set response headers for matching routes. This is where you'd set security headers like CSP, HSTS, or X-Frame-Options. The `rewrites` function maps incoming requests to different destinations without changing the URL in the browser. The `beforeFiles` array runs before checking the filesystem, `afterFiles` runs after, and `fallback` is your catchall.

These configurations are translated into CloudFront behaviors by Amplify, meaning they execute at the edge. This has performance implications—your rewrites happen close to users rather than at origin, reducing latency.

### Deployment Workflow and Build Optimization

When you push code to your repository, Amplify automatically detects the change and starts a build. The build process fetches your code, runs the build commands specified in `amplify.yml`, and then provisions the necessary Lambda functions and CloudFront distributions. Understanding this workflow helps you optimize build times and troubleshoot issues.

Build times are often the bottleneck. A typical Next.js build can take 30 seconds to several minutes depending on the size of your application. Amplify caches `node_modules` between builds, which helps significantly. If you're experiencing slow builds, consider these optimization strategies:

First, ensure you're using `npm ci` instead of `npm install`. The `ci` command respects your `package-lock.json` exactly, making it faster and more deterministic. Second, leverage Amplify's cache by committing your `package-lock.json` to version control and ensuring your dependencies are pinned to specific versions. Third, consider using a faster Node.js version. Amplify supports recent Node.js LTS versions, and newer versions are generally faster.

If your application has many dynamic pages, the build output can become large, which impacts deployment time. One optimization is to use ISR instead of SSG for pages that don't need to be pre-rendered. Pages configured for ISR are rendered on-demand after their revalidate period, reducing build time while still providing fast user experiences.

### Understanding Lambda Execution and Cold Starts

When your Next.js application is deployed to Amplify, SSR pages and API routes become Lambda functions. Lambda functions have excellent performance characteristics, but they have a quirk called cold starts. When a function hasn't been invoked for a period (typically 15 minutes), AWS removes the container, and the next invocation has to initialize the runtime, load your code, and establish connections. This can add 100-300 milliseconds to the first request after a period of inactivity.

CloudFront caching mitigates this significantly. If your page is cached at the CloudFront edge, users never hit Lambda—they get the response from the cache. However, for authenticated pages or truly dynamic content, caching isn't an option, and you'll experience occasional cold starts.

To minimize cold start impact, keep your Lambda functions lean. Remove unnecessary dependencies, use native Node.js APIs instead of large libraries when possible, and establish database connections efficiently. If your application uses a database, consider using a serverless database like DynamoDB that doesn't require connection pooling, or use AWS RDS Proxy to manage connections efficiently.

Amplify's provisioned concurrency feature can help with cold starts. By reserving a certain number of concurrent executions in advance, you ensure that there's always a warm instance available. This costs money, but for high-traffic applications, it's often worth the investment.

### Comparing Amplify Hosting to S3 + CloudFront Deployments

Many developers wonder when to use Amplify Hosting versus the simpler S3 + CloudFront combination. The fundamental difference is that S3 + CloudFront is designed for static sites, while Amplify Hosting is designed for modern applications that might need dynamic computation.

If your Next.js application uses only static generation and never needs server-side computation, S3 + CloudFront is simpler and cheaper. You build your site locally, upload the output to S3, and CloudFront distributes it. There's no Lambda overhead, no cold starts, and minimal configuration.

However, if you use SSR, API routes, or need authentication, S3 + CloudFront requires additional complexity. You'd need to set up Lambda functions manually, configure Lambda@Edge for any request manipulation, and create the integration yourself. Amplify Hosting abstracts all of this away. It automatically detects which pages need Lambda, provisions the functions, wires them into CloudFront, and manages the deployment cycle.

Amplify Hosting also provides better local development parity. When you run `next dev` locally, your application behaves similarly to how it will on Amplify. With manual S3 + CloudFront deployments, local behavior might differ from production because you're not running the same Lambda functions locally.

Cost is another consideration. S3 storage and CloudFront transfer are very cheap. Lambda invocations and duration have a per-request cost. For low-traffic sites, Amplify is often cheaper because you're only paying for the requests you actually handle. For high-traffic sites with lots of SSR, you might spend more on Lambda than the equivalent EC2 instance would cost, making S3 + CloudFront more economical if you can structure your site as static.

In practice, Amplify Hosting is ideal for applications with mixed static and dynamic content, applications that need to scale automatically without operational overhead, and teams that want a unified CI/CD and deployment platform. S3 + CloudFront remains the right choice for purely static sites where you control the build and deployment process through other means.

### Monitoring and Troubleshooting Deployments

Once your Next.js application is deployed to Amplify, it's important to monitor its behavior and troubleshoot issues. Amplify provides several tools for this. The Amplify console shows your deployment history, build logs, and basic metrics. You can see exactly where builds fail and why, which helps with debugging configuration issues.

For runtime issues, CloudWatch is your best friend. API routes and SSR pages log to CloudWatch automatically. You can add custom logging to understand request flow:

```javascript
export async function getServerSideProps(context) {
  console.log('Request path:', context.resolvedUrl);
  console.log('Request method:', context.req.method);
  
  // Your logic here
}
```

CloudWatch logs appear in the Amplify console and in the AWS CloudWatch service itself, where you can search and filter them. CloudWatch Insights lets you run queries across your logs to understand patterns and troubleshoot issues.

If a page is returning errors, check the CloudWatch logs first. Look for 502 errors (bad gateway), which usually indicate Lambda failures, or 504 errors (gateway timeout), which indicate the Lambda function timed out. The actual error message in CloudWatch will tell you what went wrong.

Another common issue is environment variables not being set. Always verify that variables you expect to be available are actually configured in the Amplify console. Use a simple test page to log environment variables and confirm they're present:

```javascript
export async function getServerSideProps() {
  console.log('Available env vars:', Object.keys(process.env).filter(k => k.includes('CUSTOM')));
  
  return { props: {} };
}
```

### Optimizing Performance and User Experience

Beyond basic functionality, Amplify Hosting gives you tools to optimize the actual user experience. Next.js's Image component works exceptionally well with Amplify because images are automatically optimized and cached globally. Always use the Image component instead of plain `img` tags for better performance.

Code splitting is handled automatically by Next.js and works well on Amplify. Each page becomes its own JavaScript bundle, so users only download the code they need. Dynamic imports further optimize this:

```javascript
const HeavyComponent = dynamic(() => import('./HeavyComponent'), {
  loading: () => <div>Loading...</div>,
});
```

Consider your caching strategy carefully. Static pages should have aggressive cache headers. Dynamic pages should use lower cache values or no-cache headers, depending on how frequently they change. ISR offers a middle ground: the page is cached at the edge, but Lambda regenerates it periodically.

If your application has both public and authenticated content, consider how to structure pages. Public pages can be cached aggressively. Authenticated pages should either have short cache times or be marked as uncacheable. Amplify's routing configuration lets you set different cache behaviors for different paths.

### Moving Forward with Next.js on Amplify

Deploying a Next.js application to Amplify Hosting is straightforward, but understanding how the platform translates your application into AWS services makes you a better architect and debugger. You now understand how Amplify handles static pages, server-side rendering, and API routes. You know how to configure your build process, manage environment variables securely, and optimize performance. You've learned when Amplify is the right choice and when S3 + CloudFront might be better suited.

The real power of Amplify emerges when you treat it not just as a deployment tool, but as a platform that understands your application structure. By leveraging features like ISR, custom headers, and intelligent caching, you can build fast, scalable applications without managing infrastructure. Start by deploying a simple Next.js application, observe how it's structured in the AWS console, and gradually add complexity as your needs grow. The platform rewards this approach with excellent user experiences and minimal operational overhead.
