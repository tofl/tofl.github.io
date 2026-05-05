---
title: "CodeBuild Artifacts Compared: S3, CodePipeline, and Local Caching"
---

## CodeBuild Artifacts Compared: S3, CodePipeline, and Local Caching

When you run a build in AWS CodeBuild, something important happens once the build completes: your outputs need to go somewhere. Whether that's a compiled JAR file, a packaged Node.js application, a Docker image, or a collection of build logs, you need a strategy for capturing, storing, and retrieving those artifacts efficiently. This is where understanding CodeBuild's artifact handling becomes critical—not just for getting your builds to work, but for optimizing costs and build times in a production pipeline.

In this article, we'll explore how CodeBuild manages build outputs through the `artifacts` block in your buildspec file, how caching can dramatically speed up builds, and how to navigate the real-world trade-offs between storage costs, artifact management complexity, and rebuild performance. By the end, you'll have a clear mental model for designing artifact strategies that work for your specific use case.

### Understanding the Artifacts Block in buildspec.yml

The artifacts section of your buildspec file is essentially your declaration of "here's what I want to keep after this build runs." Without it, CodeBuild would discard everything the moment the build finishes—which is rarely what you want.

Let's start with a minimal example. Consider a simple Node.js project:

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 18
  build:
    commands:
      - npm install
      - npm run build
      - npm run test

artifacts:
  files:
    - dist/**/*
    - package.json
    - package-lock.json
```

This buildspec tells CodeBuild: after the build succeeds, collect everything in the `dist` directory along with the package files and prepare them for upload. The `files` key accepts glob patterns, so `dist/**/*` means "everything under dist, recursively."

But here's where it gets interesting. By default, CodeBuild will upload these artifacts to an S3 bucket you specify (either in your project settings or through CodePipeline integration). The question becomes: which files actually matter, how should they be organized, and how much are you willing to pay to store them?

### The Role of base-directory and discard-paths

The `base-directory` and `discard-paths` settings give you fine-grained control over how your artifact hierarchy gets preserved (or flattened) when it uploads to S3.

Consider a Java project that builds a WAR file:

```yaml
version: 0.2

phases:
  build:
    commands:
      - mvn clean package

artifacts:
  base-directory: target
  files:
    - app.war
    - libs/*.jar
```

Without specifying `base-directory`, CodeBuild would upload `target/app.war` and `target/libs/*.jar` to S3, preserving that directory structure. By setting `base-directory: target`, you're saying "use the `target` directory as the root of my artifact structure." Now in S3, you'll have `app.war` and `libs/*.jar` at the top level, not nested under `target`.

The `discard-paths` setting takes this a step further. When set to `true`, it flattens your entire artifact structure into a single directory level, stripping away all subdirectories. This is occasionally useful for simple outputs, but it's worth using carefully—you can easily lose important organizational structure and create naming collisions.

```yaml
artifacts:
  files:
    - dist/**/*
    - config/settings.json
  discard-paths: true
```

With `discard-paths: true`, both `dist/index.html` and `config/settings.json` would land at the same level in your S3 artifact location. This can be problematic if you have files with the same name in different directories.

### Where Artifacts Actually Go: S3 vs. CodePipeline

This is a crucial distinction that often confuses developers. When CodeBuild is used standalone (not as part of a pipeline), artifacts are always uploaded to an S3 bucket—you configure this in the CodeBuild project settings. When CodeBuild is integrated into a CodePipeline, the behavior changes slightly.

In a pipeline context, CodeBuild can pass artifacts directly to the next stage without necessarily storing them permanently in your own S3 bucket. However, internally, CodePipeline still uses an artifact store (an S3 bucket it manages) to hand off outputs between stages. This is transparent to you, but understanding it matters for cost and compliance reasons.

When you define artifacts in a standalone CodeBuild project, they go to your specified S3 bucket and stay there until you delete them. This is useful for long-term storage—maybe you want to archive every build output or make them available for download. But it also means you're paying storage costs for every single build artifact forever, unless you set up lifecycle policies.

In a pipeline, intermediate artifacts between stages are stored in CodePipeline's artifact store and are typically cleaned up automatically after a retention period. This is more cost-efficient for most workflows because you're not keeping thousands of build outputs lying around.

### Caching for Speed: The cache Block

Now we come to one of the most impactful optimizations available in CodeBuild: caching. The `cache` block in your buildspec file lets you persist dependencies and build artifacts between builds, which can slash build times dramatically.

Consider a Node.js project without caching:

```yaml
version: 0.2

phases:
  install:
    commands:
      - npm install
  build:
    commands:
      - npm run build
```

Every single build downloads all dependencies from npm, which can take a minute or more even on a fast network. Now add caching:

```yaml
version: 0.2

phases:
  install:
    commands:
      - npm install
  build:
    commands:
      - npm run build

cache:
  paths:
    - node_modules/**/*
```

The first build still downloads everything. But subsequent builds? CodeBuild restores `node_modules` from cache before the install phase, so `npm install` runs against an already-populated directory. On subsequent builds, it only downloads new or updated packages, typically finishing in seconds instead of a minute.

CodeBuild supports two cache backends: S3 and local cache. Local cache is simpler and faster—it stores cached data on the build instance itself for the duration of the build and subsequent builds on the same instance. It's perfect for development environments or when you're running the same project repeatedly. S3 cache is more durable and shared across all build instances; it persists even if your build instance is recycled, making it ideal for production pipelines.

Here's how you specify each:

```yaml
cache:
  paths:
    - node_modules/**/*
```

This defaults to local cache. To explicitly use S3:

```yaml
cache:
  paths:
    - node_modules/**/*
  s3-location: my-build-cache-bucket/my-project
```

The S3 location is a bucket and prefix where CodeBuild will store your cache. You're responsible for managing that bucket—though you might set up a lifecycle policy to delete cache entries older than, say, 30 days, to control costs.

For a Java project, you might cache the Maven repository:

```yaml
cache:
  paths:
    - /root/.m2/**/*
  s3-location: my-build-cache-bucket/maven-cache
```

This prevents Maven from re-downloading every dependency artifact on each build. Similarly, for Python projects, you can cache pip dependencies:

```yaml
cache:
  paths:
    - /root/.cache/pip/**/*
  s3-location: my-build-cache-bucket/python-cache
```

### Real-World Trade-Offs: Cost vs. Speed

Here's where the practical architecture decisions come in. Every optimization has a cost, and you need to think clearly about your priorities.

Let's imagine you have a high-frequency CI/CD pipeline that runs 100 builds per day. Without caching, each build takes 3 minutes due to dependency downloads. That's 300 minutes of build time per day. With S3 caching, you cut that to 30 seconds per build on average (after the first build), saving you roughly 270 minutes of compute time daily.

At typical CodeBuild pricing (roughly $0.005 per build minute for standard instances), you're saving about $1.35 per day, or $40 per month. The S3 cache itself, assuming each cache package is 200 MB and you keep 30 days worth, costs maybe $0.50 per month for storage. The math heavily favors caching.

But there's a catch: stale cache can cause problems. If a dependency breaks or a security update is released, your cache keeps serving the old version. Good practice is to either use cache keys that include a hash of your dependency lock file, or implement periodic cache invalidation. CodeBuild doesn't have built-in cache invalidation, so you need to manage this through your pipeline logic or manual maintenance.

For artifacts, the cost-benefit analysis is different. Storing build artifacts in S3 costs money—roughly $0.023 per GB per month for standard storage. If your artifacts average 50 MB and you run 100 builds per day, that's 5 GB of new artifacts daily, or 150 GB per month. At standard S3 rates, that's about $3.50 per month in storage costs. For many organizations, that's trivial. But if you're running thousands of builds with large artifacts (Docker images, for instance), it adds up.

The decision tree looks like this: Are these artifacts needed long-term for compliance, debugging, or rollback purposes? Store them in S3 with a retention policy. Are they just intermediate outputs passed to the next pipeline stage? Let CodePipeline manage them in its artifact store. Are they exceptionally large (like Docker images)? Consider pushing to ECR instead of storing as build artifacts.

### Practical Examples for Different Project Types

Let's walk through some concrete examples to show how these concepts come together in real projects.

#### Node.js Web Application

A typical Node.js web application builds static assets and needs them packaged for deployment:

```yaml
version: 0.2

phases:
  pre_build:
    commands:
      - echo "Installing dependencies..."
  install:
    commands:
      - npm ci
  build:
    commands:
      - npm run lint
      - npm run build
      - npm run test

artifacts:
  files:
    - dist/**/*
    - package.json
    - package-lock.json
    - node_modules/**/*
  base-directory: .
  name: web-app-artifact

cache:
  paths:
    - node_modules/**/*
  s3-location: my-cache-bucket/node-cache
```

Notice that we cache `node_modules` to speed up builds, but we also include it in the artifacts. This is intentional—the downstream deployment stage needs those node_modules to avoid another npm install. The cache lets us avoid re-downloading, but the artifacts ensure the deployment environment gets exactly what we tested.

#### Java Maven Project

Java builds benefit heavily from dependency caching:

```yaml
version: 0.2

phases:
  build:
    commands:
      - mvn clean package -DskipTests
  post_build:
    commands:
      - echo "Build completed"

artifacts:
  files:
    - target/app.jar
    - target/libs/*.jar
  base-directory: target

cache:
  paths:
    - /root/.m2/**/*
  s3-location: my-cache-bucket/maven-cache
```

Here, the artifacts are just the compiled JAR files—the source code is already in version control, and the Maven cache speeds up subsequent builds by avoiding re-downloads. The output is lean and focused on what actually needs to be deployed.

#### Docker-Based Project

For projects that build and push Docker images, the artifact strategy is entirely different:

```yaml
version: 0.2

phases:
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
      - REPOSITORY_URI=$AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com/my-app
      - COMMIT_HASH=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-7)
      - IMAGE_TAG=${COMMIT_HASH:=latest}
  build:
    commands:
      - echo Build started on `date`
      - docker build -t $REPOSITORY_URI:$IMAGE_TAG .
      - docker tag $REPOSITORY_URI:$IMAGE_TAG $REPOSITORY_URI:latest
  post_build:
    commands:
      - echo Build completed on `date`
      - docker push $REPOSITORY_URI:$IMAGE_TAG
      - docker push $REPOSITORY_URI:latest
      - echo Writing image definitions file...
      - printf '[{"name":"my-app","imageUri":"%s"}]' $REPOSITORY_URI:$IMAGE_TAG > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json

cache:
  paths:
    - /root/.docker/**/*
  s3-location: my-cache-bucket/docker-cache
```

In this case, the artifact is just the image definitions file—a small JSON file that tells the downstream deployment stage which Docker image to use. The actual Docker image lives in ECR, not in S3. Caching helps by preserving Docker layers, speeding up subsequent builds.

### Debugging Artifact Issues

When things go wrong with artifacts, it's usually one of a few issues. First, verify your glob patterns actually match files. A common mistake is using `**/*` when you meant `**/` (directory recursion). Test your patterns locally before committing them.

Second, check file permissions. If CodeBuild can't read a file due to permissions, it silently skips it. Ensure your build process outputs files that the CodeBuild service role can access.

Third, understand that artifact paths are relative to your source directory, not your working directory. If your build outputs files to `/tmp/output`, your artifact pattern should reference the relative path from the source root.

Finally, monitor your S3 bucket for unexpected growth. Enable S3 CloudTrail logging or use S3 inventory reports to understand what's accumulating. You'd be surprised how quickly test outputs, logs, and build artifacts can consume storage and inflate your AWS bill.

### Putting It All Together

The key to effective artifact management in CodeBuild is understanding what you're trying to achieve with each output. Ask yourself: Do I need this for deployment? For debugging? For compliance? For how long? How large is it? Does it contain sensitive information?

Caching is almost always worth implementing—it's one of the easiest performance wins in your CI/CD pipeline. Start with local cache for development, then move to S3 cache for production pipelines. Set up periodic cache invalidation to prevent stale dependencies from causing subtle bugs.

For artifacts, be intentional. Don't store everything just because you can. Use base-directory and discard-paths to keep your S3 structure clean and predictable. Implement lifecycle policies on your artifact buckets to automatically delete old outputs. And where possible, leverage specialized services—ECR for Docker images, CodeArtifact for language-specific packages—rather than treating S3 as a general-purpose artifact repository.

The builds that run fastest and cost the least aren't the ones where nothing is cached; they're the ones where caching and artifact strategies are thoughtfully aligned with actual operational needs. As you design your CI/CD pipelines, let that principle guide your decisions.
