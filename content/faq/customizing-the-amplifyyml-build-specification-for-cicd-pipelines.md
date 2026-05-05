---
title: "Customizing the amplify.yml Build Specification for CI/CD Pipelines"
---

## Customizing the amplify.yml Build Specification for CI/CD Pipelines

When you deploy an application to AWS Amplify Hosting, you're trusting the platform to orchestrate a series of build steps that transform your source code into a live application. But the default build process isn't always right for every project. Some applications need custom build commands, others require environment-specific configuration, and many benefit from intelligent caching strategies that slash build times. That's where the `amplify.yml` file comes in—a deceptively powerful configuration file that gives you fine-grained control over exactly how Amplify builds and deploys your application.

Whether you're setting up a complex CI/CD pipeline with multiple environments, optimizing build times for a large team, or debugging a stubborn build failure, understanding how to customize your `amplify.yml` is essential. This article walks you through the anatomy of this configuration file, shows you how to structure it for different phases and scenarios, and demonstrates practical patterns you'll use in real-world deployments.

### Understanding the amplify.yml Structure

The `amplify.yml` file lives in the root of your repository and serves as the blueprint for Amplify Hosting's build process. It's a YAML file that defines everything from pre-build hooks to dependency caching to test execution. Think of it as your CI/CD pipeline's instruction manual—Amplify reads this file and executes its directives in order.

The basic structure divides build activities into distinct phases: frontend, backend, and test. Each phase can contain pre-build, build, and post-build commands. This hierarchical organization lets you separate concerns and ensures that operations happen in a logical sequence.

Here's a minimal but complete `amplify.yml`:

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
    postBuild:
      commands:
        - echo "Build complete"
  artifacts:
    baseDirectory: build
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

This example installs dependencies, builds the application, outputs a message, and tells Amplify where to find the built artifacts. It also caches `node_modules` so that future builds don't need to reinstall every package from scratch.

The `version: 1` declaration at the top signals to Amplify which schema version you're using. Currently, version 1 is the standard and supports all modern features you'll need.

### Organizing Build Phases: Pre-Build, Build, and Post-Build

The three-phase approach—pre-build, build, and post-build—creates a natural flow for your build process. Understanding when each phase executes helps you place commands in the right location.

**Pre-build** runs first and typically handles setup tasks. This is where you install dependencies, download external resources, or verify that your environment has everything needed for the build to succeed. If a pre-build command fails, the entire build stops and your deployment is halted. Use this phase as a quality gate for prerequisites.

**Build** is the main event. Here your application gets compiled, bundled, or otherwise transformed into its deployable form. For a React app, this might be running `npm run build`. For a Next.js application, it's the command that generates static pages and server bundles. This phase is where the actual application compilation happens.

**Post-build** executes after a successful build. It's perfect for cleanup tasks, running additional processing on build artifacts, or preparing final deployment assets. Many developers use post-build to optimize images, minify CSS, or generate sitemap files.

Here's a more realistic example that shows all three phases in action:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
        - npm run lint
    build:
      commands:
        - npm run build
        - npm run generateSitemap
    postBuild:
      commands:
        - npm run optimizeImages
        - echo "Deployment ready"
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

Notice how the flow is logical: verify everything is available and correct (pre-build), create the application (build), polish the result (post-build). If linting fails in pre-build, the build stops before wasting time on compilation. If the build itself fails, post-build optimizations never run.

### Backend and Test Phases

Not all applications are frontend-only. If your Amplify project includes backend resources—like Lambda functions, API Gateway endpoints, or GraphQL APIs—you can define a backend phase in your `amplify.yml`.

The backend phase typically runs before the frontend phase and handles backend compilation, code generation, or other backend-specific tasks. Here's how it fits in:

```yaml
version: 1
backend:
  phases:
    build:
      commands:
        - amplifyPush --simple
        - npm run generateTypes
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
```

The `amplifyPush --simple` command deploys your backend infrastructure. The `generateTypes` command might use AWS Amplify's code generation to create TypeScript types based on your GraphQL schema. By putting these in the backend phase, you ensure your frontend build has access to generated code and APIs.

The test phase deserves special mention because it can act as a quality gate for your entire deployment. Tests run after your build completes, and if any test fails, the deployment is rejected. This is powerful—it means broken code never makes it to production.

```yaml
version: 1
frontend:
  phases:
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
test:
  phases:
    build:
      commands:
        - npm run test -- --coverage
```

When you structure your pipeline this way, every deployment is validated by your test suite. Developers quickly learn that their code must pass tests to reach production, which naturally incentivizes thorough testing.

### Smart Caching for Faster Builds

One of the highest-impact optimizations you can make to your build process is caching. Downloading and installing hundreds of npm packages takes time. Caching `node_modules` between builds means subsequent builds skip this step entirely—often cutting build time in half or more.

The `cache` section under `frontend` (or `backend`) tells Amplify which files and directories to preserve between builds:

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
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
      - .next/cache/**/*
      - .eslintcache
```

This caches three important directories: `node_modules`, Next.js's build cache, and ESLint's cache. The `**/*` syntax matches all files recursively within those directories.

The caching strategy deserves careful thought. Caching too much wastes storage; caching too little means you miss optimization opportunities. Generally, cache package directories (`node_modules`, `vendor`, etc.), build caches (`.next/cache`, `dist/`, etc.), and tool caches (`.eslintcache`). Don't cache generated files that might become stale between builds.

One important note: Amplify invalidates the entire cache when your build environment changes. This means if you update your compute instance type or AWS updates the underlying build image, Amplify discards the cache and rebuilds from scratch. This is actually a safety feature—it prevents old cached artifacts from interfering with new environments.

### Environment-Specific Configuration and Variables

Real-world applications rarely have the same configuration everywhere. Production needs different API endpoints, database connections, and feature flags than development. The `amplify.yml` file supports environment variables that let you customize builds based on branch, deployment environment, or custom settings.

Environment variables can come from multiple sources: the Amplify Console's environment variable settings, branch-specific overrides, or build-time computed values. You reference them in your commands using standard shell syntax:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
        - echo "Building for environment $AMPLIFY_ENV"
    build:
      commands:
        - npm run build -- --mode $AMPLIFY_ENV
        - echo "API endpoint is $REACT_APP_API_URL"
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
```

Amplify provides some built-in variables automatically. `$AMPLIFY_ENV` tells you which Amplify environment you're deploying to. `$AWS_BRANCH` tells you which Git branch triggered the build. These are handy for conditional logic.

Suppose you want different build behavior for your main branch versus feature branches. You might skip certain expensive operations on feature branches:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - |
          if [ "$AWS_BRANCH" = "main" ]; then
            npm run build -- --analyze
          else
            npm run build
          fi
    postBuild:
      commands:
        - |
          if [ "$AWS_BRANCH" = "main" ]; then
            npm run generatePerformanceReport
          fi
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
```

In this pattern, the main branch gets analyzed for bundle size and a performance report is generated, while feature branches skip these time-consuming tasks. This keeps feature branch builds fast while ensuring production receives thorough analysis.

You can also define custom environment variables in the Amplify Console and reference them in your build commands. For example, you might set a custom variable like `ENABLE_ANALYTICS=true` for production but leave it unset for staging. Then in your `amplify.yml`:

```yaml
version: 1
frontend:
  phases:
    build:
      commands:
        - |
          if [ -n "$ENABLE_ANALYTICS" ]; then
            npm run build -- --analytics
          else
            npm run build
          fi
```

The `-n` test checks whether the variable is set and non-empty. This pattern gives you tremendous flexibility to customize builds without maintaining separate `amplify.yml` files.

### Running Tests as a Build Gate

One of the most important quality practices is preventing broken code from reaching production. By placing your test suite in the test phase of your `amplify.yml`, you create an automatic quality gate that must be passed before deployment.

```yaml
version: 1
frontend:
  phases:
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
test:
  phases:
    build:
      commands:
        - npm run test -- --coverage --passWithNoTests
```

When Amplify encounters a test failure, the deployment halts immediately. The application in production never gets updated, and the team gets a clear failure notification. This is tremendously valuable for maintaining stability.

You can make tests conditional based on the branch being deployed:

```yaml
version: 1
frontend:
  phases:
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
test:
  phases:
    build:
      commands:
        - |
          if [ "$AWS_BRANCH" = "main" ]; then
            npm run test -- --coverage
          else
            npm run test
          fi
```

Here, the main branch runs tests with coverage reporting (perhaps enforcing coverage thresholds), while feature branches run a faster test pass. You could also skip tests entirely on certain branches, though this is generally not recommended.

Coverage reporting in CI/CD pipelines helps track code quality over time. By running coverage on every build, you can see if your test coverage is increasing or decreasing and enforce minimum coverage thresholds:

```yaml
test:
  phases:
    build:
      commands:
        - npm run test -- --coverage --coverageThreshold='{"global":{"branches":70,"functions":70,"lines":70,"statements":70}}'
```

This test command fails if coverage drops below 70%, ensuring code quality never regresses.

### Handling Common Build Failures and Troubleshooting

Even with a well-configured `amplify.yml`, builds sometimes fail. Understanding common failure patterns and how to debug them is essential for maintaining a reliable CI/CD pipeline.

**Dependency installation failures** are common, especially when you're using exact versions in your lock file. These typically manifest as `npm ci` failing with version mismatch errors. The solution is often to check that your local `package-lock.json` (or `yarn.lock`) is up to date with your `package.json`. Always commit lock files to your repository.

**Build command failures** might indicate that required environment variables are missing. If your build script references `process.env.REACT_APP_API_URL` but that variable isn't defined in Amplify's environment settings, the build might fail or produce incorrect output. Always verify that all environment variables your application requires are configured in the Amplify Console.

**Out of memory errors** suggest that your build process is consuming more memory than the build instance provides. This happens most often with large TypeScript projects or webpack builds. If you encounter this, you might need to optimize your build (split chunks, lazy load, etc.) or contact AWS to discuss larger build instances.

**Test failures** that appear only in CI but not locally are frustrating but common. Usually, they indicate environment differences. Perhaps your local tests run with different timezone settings, or the CI environment has different Node.js version. To debug, review the full test output in the Amplify build logs and replicate the exact environment locally.

**Artifact not found** errors mean Amplify couldn't locate the files specified in `baseDirectory` and `files`. Double-check that your build command actually creates output in the directory you specified. For a React app built with Create React App, verify that `npm run build` creates a `build/` directory. For Next.js with static export, verify that `next build` creates an `out/` directory.

To troubleshoot, make liberal use of `echo` statements to print values and confirm assumptions:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - echo "Node version $(node --version)"
        - echo "npm version $(npm --version)"
        - echo "AMPLIFY_ENV is $AMPLIFY_ENV"
        - npm ci
    build:
      commands:
        - npm run build
        - echo "Build output directory contents:"
        - ls -la dist/
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
```

These diagnostic commands help you understand exactly what's happening during the build. The build logs in the Amplify Console will show all output, making it easy to spot misconfigurations.

### Advanced Patterns and Best Practices

As you become comfortable with `amplify.yml`, certain patterns emerge as especially useful.

**Conditional commands based on file changes** can skip expensive operations if certain files haven't changed:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - |
          if git diff HEAD~1 --name-only | grep -q "package.json"; then
            npm run audit
          fi
        - npm run build
```

This runs a security audit only if `package.json` changed since the last commit, saving time on builds that don't touch dependencies.

**Parallel operation simulation** can speed up builds when you have independent tasks:

```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build & npm run generateDocs & npm run buildAssets
        - wait
```

The `&` backgrounds the processes, and `wait` pauses until all complete. This lets long-running independent tasks run simultaneously.

**Build artifact optimization** can significantly reduce deployment size:

```yaml
version: 1
frontend:
  phases:
    build:
      commands:
        - npm run build
    postBuild:
      commands:
        - find dist -name "*.js.map" -delete
        - find dist -name "*.css.map" -delete
        - gzip -r dist/
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
```

Removing source maps and compressing files reduces bandwidth and storage. Be aware that Amplify Hosting automatically serves gzip-compressed files, so manually gzipping provides diminishing returns, but removing source maps in production builds is a common best practice.

### Version Control and Maintenance

Treat your `amplify.yml` like production code. Keep it in version control, review changes in pull requests, and maintain clear documentation about what each section does. Consider adding comments to complex build logic:

```yaml
version: 1
backend:
  phases:
    build:
      commands:
        # Deploy backend infrastructure (Lambda, DynamoDB, etc.)
        - amplifyPush --simple
frontend:
  phases:
    preBuild:
      commands:
        # Install dependencies using lock file for reproducible builds
        - npm ci
    build:
      commands:
        # Build the React application
        - npm run build
        # Generate TypeScript types from GraphQL schema
        - npm run generateTypes
  artifacts:
    baseDirectory: build
    files:
      - '**/*'
  cache:
    paths:
      # Cache node_modules to avoid reinstalling on every build
      - node_modules/**/*
test:
  phases:
    build:
      commands:
        # Run test suite with coverage reporting
        - npm run test -- --coverage
```

Well-commented configuration files make it easier for new team members to understand your CI/CD pipeline and reduce the likelihood of well-intentioned changes that break the build.

### Conclusion

The `amplify.yml` file transforms Amplify Hosting from a platform that handles the basics into a sophisticated CI/CD system tailored to your exact needs. By understanding its structure—the frontend, backend, and test phases; the pre-build, build, and post-build sequence; and the caching and environment variable capabilities—you gain the power to optimize, customize, and automate your deployment pipeline.

Start with a simple configuration that works for your application, then iteratively add optimizations like caching and branch-specific logic. Use environment variables to keep your configuration flexible and DRY. Implement tests as a quality gate that protects production. And always watch your build logs during development to understand exactly what's happening at each step.

With these practices in place, your Amplify Hosting pipeline becomes a reliable, fast, and maintainable part of your development workflow—one less thing to worry about as you focus on building great applications.
