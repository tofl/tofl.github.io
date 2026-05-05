---
title: "CDK Asset Management: Bundling Docker Images, Files, and Dependencies"
---

## CDK Asset Management: Bundling Docker Images, Files, and Dependencies

When you deploy infrastructure as code with AWS CDK, you're not just defining cloud resources—you're also packaging and moving bits of your application across the network. Docker images need to end up in Amazon ECR, Lambda source code needs to land in Amazon S3, and custom data files need to be available when your infrastructure spins up. This is where CDK's asset management system comes in. It's one of those behind-the-scenes features that developers often don't think about until something goes wrong or deployment takes unexpectedly long.

In this article, we'll explore how CDK handles assets from bundling through deployment, why the fingerprinting mechanism matters for your deployment speed, and how to optimize your asset pipeline for both small development iterations and large production deployments.

### Understanding Assets in CDK

An asset, in CDK terminology, is any file, directory, or Docker image that needs to be packaged and uploaded as part of your infrastructure deployment. This could be the source code for a Lambda function, a Docker image for an ECS service, a configuration file referenced by your stack, or even a data file that gets imported into a database on first deployment.

The key insight is this: CDK doesn't just define resources; it also manages the **delivery** of the code and images those resources depend on. Without the asset management system, you'd manually have to build Docker images, upload them to a registry, create S3 buckets to hold Lambda zip files, and reference all of this in your infrastructure code. CDK automates all of that.

When you synthesize your CDK app with `cdk synth` or deploy with `cdk deploy`, the framework scans your code for assets, bundles them appropriately, generates a fingerprint for each one, and then uploads them to your account's bootstrapped S3 bucket (or ECR repository for Docker images). The CloudFormation template that gets deployed then references these uploaded assets, ensuring your infrastructure can access what it needs.

### How Asset Bundling Works

Bundling is the process of preparing an asset for deployment. Different asset types go through different bundling pipelines. For a Lambda function written in TypeScript, bundling might involve transpiling code, installing npm dependencies, and creating a zip file. For a Docker image, bundling means building the image locally and pushing it to a registry. For a static file, bundling might just mean copying it somewhere accessible.

CDK uses what's called a "bundler" for each asset type. The framework comes with built-in bundlers for common scenarios: Lambda functions in Node.js, Python, Java, and Go; Docker images for container-based workloads; and raw files. These bundlers run during the synthesis phase, preparing assets locally before they're uploaded.

Let's say you have a simple Lambda function. When you define it in CDK like this:

```typescript
const handler = new lambda.Function(this, 'MyFunction', {
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset('./src'),
});
```

CDK recognizes that `./src` is an asset. During synthesis, it will bundle the contents of that directory (installing any dependencies found in package.json if they exist), create a zip file, and prepare it for upload. If you later deploy this stack, CDK will upload the zip to S3 and reference it in the CloudFormation template.

The bundling process happens locally by default, which is convenient during development but can have implications if your development environment differs from your deployment environment. This is why CDK also supports bundling inside a Docker container, ensuring consistency across different machines and CI/CD systems.

### Asset Fingerprinting and Change Detection

Here's a powerful feature that often goes unnoticed: CDK's fingerprinting system. Every asset gets a fingerprint—a hash computed based on the asset's contents. This fingerprint is part of the logical identifier for that asset. When you deploy again without changing your code, CDK recognizes that the asset hasn't changed by comparing fingerprints.

Why does this matter? Because it saves time and bandwidth. If nothing has changed in your Lambda function's source code, CDK doesn't re-upload it to S3. The CloudFormation template can simply reference the version that's already there. This is especially valuable in continuous deployment pipelines where you might deploy dozens of times per day.

The fingerprint is computed from the actual file contents, not from timestamps. This means that if you make a change to your source code, the fingerprint changes, and CDK knows it needs to re-bundle and re-upload. Conversely, if you revert a change or restore a file to an earlier state, the fingerprint goes back to what it was before, and CDK recognizes it as unchanged.

It's worth noting that CDK uses a deterministic hashing algorithm, so the same source code always produces the same fingerprint. This is crucial for consistent deployments and for avoiding unnecessary updates.

However, fingerprinting can be surprising in some edge cases. For instance, if your bundling process includes timestamps or random data, the fingerprint will be different every time, even if your actual source code hasn't changed. This is one reason why CDK provides options to exclude certain files from the bundling process or to manually specify what should be included.

### The Bootstrap Bucket and Asset Deployment

Before CDK can upload assets, your AWS account needs to be bootstrapped. The bootstrap process creates an S3 bucket (often named something like `cdk-hnb659fds-assets-123456789012-us-east-1`) and the necessary IAM roles for CDK to upload to it and for CloudFormation to access it.

When you deploy a stack with assets, here's what happens under the hood. First, CDK synthesizes your app and identifies all assets. Each asset is bundled locally (or in Docker, depending on your configuration). Then, for each asset, CDK uploads it to the bootstrap bucket. The upload happens to a specific key that includes the asset's fingerprint, ensuring that different versions of an asset don't overwrite each other.

Finally, the CloudFormation template that gets deployed contains references to these uploaded assets. When CloudFormation creates or updates resources, it can pull the Lambda code from S3, the Docker image from ECR, or whatever else it needs.

One important detail: the bootstrap bucket is account-specific and region-specific. If you deploy to multiple regions, each region needs its own bootstrap. CDK typically handles this automatically when you run `cdk deploy` for the first time in a region, but you can also manually bootstrap an account with `cdk bootstrap`.

### Bundling a Docker Image for ECS

Let's work through a concrete example: bundling a custom Docker image for an ECS service. This scenario is common when you're containerizing an application that isn't available as a pre-built image on Docker Hub.

Suppose you have a simple Node.js web server in a subdirectory called `app`, and you want to run it in ECS. First, you'd create a Dockerfile:

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
```

In your CDK code, you'd define an ECS cluster and a Fargate service that uses this image:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as assets from 'aws-cdk-lib/aws-ecr-assets';

export class MyEcsStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', { maxAzs: 2 });

    const cluster = new ecs.Cluster(this, 'Cluster', { vpc });

    const image = ecs.ContainerImage.fromAsset('./app', {
      file: 'Dockerfile',
    });

    new ecs.FargateService(this, 'Service', {
      cluster,
      taskImageOptions: {
        image,
        containerPort: 3000,
      },
      desiredCount: 2,
    });
  }
}
```

When you deploy this stack, CDK will:

1. Detect that you're using a Docker image from a local asset
2. Build the image locally using your Dockerfile
3. Push the built image to an ECR repository in your AWS account
4. Update the ECS task definition to reference the image in ECR

The beauty of this approach is that it's all automatic. You don't manually create the ECR repository, build the image, or push it. CDK handles it as part of the synthesis and deployment process.

The fingerprinting system is especially valuable here. If you modify your Node.js application code, the Docker image gets rebuilt and pushed to ECR. But if you only modify something external to your app (like adding a comment to a configuration file that isn't copied into the Docker image), the image isn't rebuilt, saving you time.

You can also customize the build context, build arguments, and other Docker build options:

```typescript
const image = ecs.ContainerImage.fromAsset('./app', {
  file: 'Dockerfile',
  buildArgs: {
    BUILD_ENV: 'production',
  },
  target: 'production',
});
```

### Bundling Lambda Functions with Dependencies

Lambda functions often depend on third-party libraries. For Node.js, this means npm packages. For Python, pip packages. CDK's Lambda bundling system handles installing these dependencies and creating a deployment package that includes them.

Here's an example of a Lambda function that uses the AWS SDK and a popular utility library:

```typescript
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';

new nodejs.NodejsFunction(this, 'ProcessorFunction', {
  entry: './src/index.ts',
  runtime: lambda.Runtime.NODEJS_18_X,
  handler: 'handler',
  bundling: {
    externalModules: ['aws-sdk'],
    minify: true,
    sourceMap: true,
  },
});
```

The `NodejsFunction` construct is a higher-level abstraction that handles bundling for you. It will:

1. Transpile your TypeScript to JavaScript
2. Install dependencies from `package.json` using npm or yarn
3. Bundle the code and dependencies into a zip file
4. Upload the zip to S3

The `bundling` configuration object lets you fine-tune the process. The `externalModules` option tells CDK to exclude `aws-sdk` from the bundle since it's already available in the Lambda runtime. The `minify` option reduces the size of your code, and `sourceMap` preserves debugging information.

If you're using more complex dependencies or need more control, you can also specify custom build steps:

```typescript
new nodejs.NodejsFunction(this, 'ComplexFunction', {
  entry: './src/index.ts',
  runtime: lambda.Runtime.NODEJS_18_X,
  bundling: {
    nodeModules: ['node-gyp-dependent-package'],
    buildImage: lambda.Runtime.NODEJS_18_X.bundlingImage,
    environment: {
      npm_config_build_from_source: 'true',
    },
  },
});
```

Here, we're telling CDK to bundle specific native modules and to use a custom environment variable during the build. This is useful when you have dependencies that need to be compiled for the Linux environment that Lambda uses.

### Optimizing Asset Size and Deployment Speed

As your application grows, asset sizes can become a bottleneck. A Lambda function with a large `node_modules` directory, or a Docker image that includes unnecessary dependencies, can significantly slow down deployments.

Here are some practical strategies to keep your assets lean:

**For Lambda functions**, use the `externalModules` option to exclude packages that are already available in the Lambda runtime. The AWS SDK, for instance, is available in all Lambda runtimes, so there's no need to bundle it. Likewise, if you're using only a subset of a large package, consider whether there are lighter-weight alternatives. Use production-only dependencies (with `npm install --production`) rather than including dev dependencies.

**For Docker images**, follow container best practices. Use a smaller base image, like Alpine Linux instead of Ubuntu. Multi-stage builds can dramatically reduce image size—build your application in one stage and copy only the final artifacts into a minimal runtime image. Don't copy unnecessary files into the image; use `.dockerignore` to exclude build artifacts, tests, and documentation.

**For general assets**, CDK provides several options to control what gets bundled. You can exclude files using patterns, include only specific directories, or even write custom bundling logic. The `ignoreMode` option in `Code.fromAsset()` lets you specify how to handle file exclusions—whether to use gitignore rules, custom patterns, or include everything:

```typescript
const code = lambda.Code.fromAsset('./src', {
  ignoreMode: cdk.IgnoreMode.GIT,
});
```

This tells CDK to respect your `.gitignore` file when bundling, automatically excluding things like node_modules and build artifacts.

**For deployment speed in CI/CD**, consider using Docker bundling consistently rather than bundling on your local machine. This ensures all developers and CI agents build assets identically, reducing redundant uploads. You can also leverage the fact that fingerprints remain consistent—if your CI/CD pipeline caches the bundled assets and only redeploys when fingerprints change, you can avoid rebuilding assets unnecessarily.

### Custom Bundlers and Advanced Scenarios

Sometimes the built-in bundlers aren't quite right for your use case. CDK allows you to define custom bundling logic. This is useful if you have a unique build process or need to integrate with tools outside the standard pipeline.

You can specify custom bundling commands at the construct level:

```typescript
const code = lambda.Code.fromAsset('./src', {
  bundling: {
    image: cdk.DockerImage.fromRegistry('node:18'),
    command: [
      'bash', '-c',
      'npm install && npm run build && cp -r dist /asset-output/',
    ],
  },
});
```

Here, we're telling CDK to use a custom Docker image and a custom command to bundle the asset. The command runs inside the Docker container, and the `/asset-output/` directory is where you place the files that should be included in the final asset.

This flexibility is powerful but also requires care. Custom bundlers still need to respect the asset input/output contract—they read from a standard location and write to `/asset-output/`. Getting this wrong can result in broken deployments.

### Understanding Asset Uploading and References

When assets are uploaded to the bootstrap S3 bucket, they're organized by a specific key structure. The key includes the asset's fingerprint, which ensures that different versions of the same asset don't collide. This design is important because it allows CloudFormation to safely manage multiple versions of the same asset without worrying about overwrites.

The CloudFormation template generated by CDK contains references to these assets. For Lambda functions, this might look like:

```json
"Code": {
  "S3Bucket": "cdk-hnb659fds-assets-123456789012-us-east-1",
  "S3Key": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6.zip"
}
```

For Docker images, the reference is to an ECR repository URL:

```json
"Image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/cdk-hnb659fds-ecr-repo-123456789012-us-east-1:a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
```

These references are deterministic—the same asset always generates the same reference. This is crucial for CloudFormation to recognize when an asset has changed and when it hasn't.

### Troubleshooting Common Asset Issues

Asset problems often manifest as cryptic errors during deployment. Here are some common issues and how to resolve them:

**Asset fingerprint keeps changing even though nothing changed**: This usually means your bundling process is including timestamps or other non-deterministic data. Check if your build process is including files with timestamps (like compiled artifacts with modification dates). Consider using `ignoreMode` to exclude these files, or adjust your bundling logic to be more deterministic.

**Docker image builds fail in CI/CD but work locally**: This often happens when your Docker build assumes a certain environment—maybe build tools installed locally aren't available in the Docker container. Use Docker buildx or similar tools to test your Docker builds in an Alpine-like environment, matching what CDK will use.

**Deployment is slow because assets are large**: Profile your assets to see what's taking up space. For Docker images, use `docker history` to see which layers are largest. For Lambda functions, use `npm ls --depth=0` to understand your dependency tree. Remove unnecessary dependencies and use the optimizations mentioned earlier.

**Permission errors when uploading to S3 or ECR**: This usually means the IAM role used during deployment doesn't have the necessary permissions. Ensure that the deployment role has `s3:PutObject` permissions on the bootstrap bucket and `ecr:BatchPutImage` on ECR repositories. If you're using cross-account deployments, ensure trust relationships are properly configured.

### Moving Forward with Assets

CDK's asset system abstracts away a lot of operational complexity, but understanding how it works is essential for building reliable, efficient deployments. The fingerprinting mechanism is a subtle but powerful feature that keeps your deployments fast by avoiding unnecessary uploads. The bundling system ensures that dependencies are properly prepared for their target environments.

As you build more complex applications with CDK, you'll appreciate how the asset system scales from simple projects to sophisticated multi-service deployments. Investing time in optimizing your assets early—keeping Docker images small, managing Lambda dependencies carefully, and leveraging fingerprinting—pays dividends as your deployment frequency increases.

The next natural step is exploring how CDK integrates with your CI/CD pipeline and how to handle cross-stack asset sharing, but the foundations we've covered here will serve you well as you build more advanced deployments.
