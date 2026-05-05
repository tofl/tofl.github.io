---
title: "Building a CI/CD Pipeline with CodeBuild, ECR, and ECS"
---

## Building a CI/CD Pipeline with CodeBuild, ECR, and ECS

Continuous integration and continuous deployment have become the backbone of modern application development. Yet setting up a full pipeline that moves code from source to production can feel overwhelming—especially when you're coordinating multiple AWS services that each have their own configuration quirks and IAM permission requirements. This article walks you through building a complete, production-ready CI/CD pipeline using AWS CodePipeline, CodeBuild, ECR, and ECS. By the end, you'll understand not just what each piece does, but how to wire them together securely and how to choose between deployment strategies that fit your team's needs.

### Understanding the Pipeline Architecture

Before diving into configuration, let's visualize what we're building. A typical pipeline for containerized applications follows this flow: a developer commits code to a source repository (CodeCommit or GitHub), which triggers an automated build process that compiles the application and packages it into a Docker image. That image gets pushed to Amazon ECR, your private container registry. Finally, CodePipeline orchestrates the deployment of that image to ECS, which runs your containers in a managed environment.

This architecture separates concerns beautifully. Your build process is isolated from your deployment process. Your container registry is independent and can be used by multiple teams. And ECR integrates seamlessly with ECS, so the handoff between building and deploying feels natural. The magic glue that ties everything together is CodePipeline, which watches your source repository, triggers CodeBuild when code changes, and then deploys the resulting artifacts to ECS.

The real power emerges once you understand the roles and permissions at each stage. A poorly configured IAM policy will leave you debugging cryptic errors, while proper permissions from the start make the whole system transparent and secure.

### Setting Up Your Source Repository

Your pipeline begins with a source repository. You can use AWS CodeCommit, GitHub, GitHub Enterprise, or even Amazon S3 as your source. For this walkthrough, we'll assume CodeCommit, though the concepts translate directly to GitHub.

Create a CodeCommit repository and push a simple application to it. For testing purposes, a basic Node.js application with a Dockerfile is ideal. Your repository structure might look like this:

```
my-app/
  ├── app.js
  ├── package.json
  ├── Dockerfile
  ├── buildspec.yml
  └── imagedefinitions.json
```

The `buildspec.yml` file is crucial—it's the instruction manual that tells CodeBuild how to build your Docker image. The `imagedefinitions.json` file tells ECS which container image to deploy. We'll explore both in detail shortly.

One subtle point: CodePipeline needs permission to poll your source repository or respond to webhooks. If you're using CodeCommit, ensure your CodePipeline service role has the `codecommit:GetBranch` and `codecommit:GetCommit` permissions. If you're using GitHub, you'll need to create a personal access token and store it in AWS Secrets Manager or pass it directly during pipeline creation.

### Creating and Configuring CodeBuild

CodeBuild is AWS's managed build service, and it's where your Docker image gets created. To use it, you first define a build project that specifies the build environment, build commands, and artifacts.

#### The buildspec.yml File

The heart of CodeBuild is the `buildspec.yml` file, which lives in your repository root. This YAML file tells CodeBuild exactly what to do. Here's a realistic example:

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
      - echo Building the Docker image...
      - docker build -t $REPOSITORY_URI:latest .
      - docker tag $REPOSITORY_URI:latest $REPOSITORY_URI:$IMAGE_TAG
  
  post_build:
    commands:
      - echo Build completed on `date`
      - echo Pushing the Docker images...
      - docker push $REPOSITORY_URI:latest
      - docker push $REPOSITORY_URI:$IMAGE_TAG
      - echo Writing image definitions file...
      - printf '[{"name":"my-app","imageUri":"%s"}]' $REPOSITORY_URI:$IMAGE_TAG > imagedefinitions.json

artifacts:
  files:
    - imagedefinitions.json

cache:
  paths:
    - '/root/.docker/**/*'
```

Let's break down what's happening here. The `pre_build` phase authenticates Docker with your ECR registry. CodeBuild provides environment variables like `$AWS_ACCOUNT_ID` and `$AWS_DEFAULT_REGION` automatically, but you need to create an ECR repository first if you haven't already. The `build` phase runs your Docker build command and tags the image with both a `latest` tag and a tag based on the git commit hash. The `post_build` phase pushes both tags to ECR and creates the crucial `imagedefinitions.json` file.

That `imagedefinitions.json` file is what ECS uses to know which image to deploy. It's an artifact that CodePipeline passes to the deployment stage. If you forget to generate it or if it's malformed, your deployment will fail cryptically. The format is simple—it's an array of objects, each with a `name` matching your ECS task definition container name and an `imageUri` pointing to the image in ECR.

One important detail: the `cache` section tells CodeBuild to cache Docker layers between builds, which speeds up subsequent builds significantly.

#### Setting Up the CodeBuild Project

In the AWS Console, navigate to CodeBuild and create a new build project. Configure it with the following settings:

For the environment, select "Managed image" and choose the Ubuntu standard runtime with Docker enabled. You need Docker enabled since you're building container images. The service role that CodeBuild uses must have permissions to push to ECR, which we'll discuss in the IAM section.

Under "Source," point it to your CodeCommit repository and the appropriate branch. Under "Buildspec," choose "Use a buildspec file" since we've created one in our repository. CodeBuild will automatically detect and use it.

### Setting Up Amazon ECR

Amazon ECR (Elastic Container Registry) is AWS's managed Docker image registry. Before your pipeline can push images, you need a repository.

Create an ECR repository using the AWS Console or CLI:

```bash
aws ecr create-repository --repository-name my-app --region us-east-1
```

Note the repository URI that gets returned—it looks something like `123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app`. You'll reference this in your `buildspec.yml` and later when configuring ECS.

ECR has optional image scanning and lifecycle policies. Image scanning checks for known vulnerabilities, which is excellent for security. Lifecycle policies automatically clean up old images, which helps control costs. For a production system, both are worthwhile additions.

### Configuring ECS for Deployment

ECS requires a bit of setup before CodePipeline can deploy to it. You need a task definition, a service, and a cluster.

A task definition is like a template for running a container. It specifies the Docker image, memory allocation, CPU allocation, environment variables, logging configuration, and port mappings. Create one in the ECS console or via CLI. Here's a minimal CLI example:

```bash
aws ecs register-task-definition \
  --family my-app \
  --network-mode awsvpc \
  --requires-compatibilities FARGATE \
  --cpu 256 \
  --memory 512 \
  --container-definitions '[{
    "name": "my-app",
    "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest",
    "portMappings": [{"containerPort": 3000, "hostPort": 3000}],
    "logConfiguration": {
      "logDriver": "awslogs",
      "options": {
        "awslogs-group": "/ecs/my-app",
        "awslogs-region": "us-east-1",
        "awslogs-stream-prefix": "ecs"
      }
    }
  }]'
```

This example uses ECS on Fargate, which is serverless and simpler to manage. If you're running ECS on EC2 instances, the configuration is similar but you'd specify instance type and launch type differently.

The crucial detail here is that the container name (`my-app` in this case) must match the name in your `imagedefinitions.json` file. When CodePipeline deploys, it updates the image URI for the container with this name.

Next, create an ECS service that uses this task definition. The service manages how many tasks run, handles load balancing, and automatically replaces failed tasks. You'll specify the cluster, task definition, desired count, and networking. The service is where your deployment strategy comes into play, which we'll explore shortly.

### Understanding IAM Permissions at Each Stage

IAM is where many pipelines fall apart. Each service needs specific permissions to perform its role, and underprovisioning permissions leads to cryptic failures. Let's walk through the key permission sets.

**CodePipeline Service Role** needs permissions to assume other roles and read from your source. A minimal policy looks like:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "codecommit:GetBranch",
        "codecommit:GetCommit",
        "codecommit:UploadArchive",
        "codecommit:GetUploadArchiveStatus"
      ],
      "Resource": "arn:aws:codecommit:us-east-1:123456789012:my-app"
    },
    {
      "Effect": "Allow",
      "Action": [
        "codebuild:BatchGetBuilds",
        "codebuild:BatchGetReports",
        "codebuild:ListBuildsForProject",
        "codebuild:ListReports",
        "codebuild:ListReportGroups",
        "codebuild:ListProjects"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecs:UpdateService",
        "ecs:DescribeServices",
        "ecs:DescribeTaskDefinition",
        "ecs:DescribeTasks"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "iam:PassRole"
      ],
      "Resource": [
        "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
        "arn:aws:iam::123456789012:role/ecsTaskRole"
      ]
    }
  ]
}
```

**CodeBuild Service Role** needs to push to ECR and read from your source:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": "arn:aws:ecr:us-east-1:123456789012:repository/my-app"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/aws/codebuild/*"
    }
  ]
}
```

**ECS Task Execution Role** (created automatically in many cases) needs to pull from ECR and write logs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:us-east-1:123456789012:log-group:/ecs/my-app:*"
    }
  ]
}
```

Notice that we're scoping permissions to specific resources wherever possible. The `GetAuthorizationToken` action for ECR is intentionally broad because it's not resource-specific, but everything else is narrowed to the exact repositories and log groups you need.

### Building the CodePipeline

With CodeBuild, ECR, and ECS configured, it's time to assemble them into a pipeline. Navigate to CodePipeline and create a new pipeline.

**Stage 1: Source** points to your CodeCommit repository and branch. Configure it to trigger on code changes using EventBridge (which watches for push events) rather than polling, which is more responsive and cost-effective.

**Stage 2: Build** uses the CodeBuild project you created earlier. CodeBuild will automatically use the `buildspec.yml` from your repository.

**Stage 3: Deploy** is where things get interesting. Select ECS as your deployment provider. You'll specify the cluster name, service name, and image definitions file. That image definitions file is the artifact produced by CodeBuild—it's what tells ECS which image to deploy.

Once you've configured all three stages, create the pipeline. CodePipeline will immediately run through the pipeline with your current main branch. You can watch the progress in the console, and if anything fails, the error messages will point you toward the issue.

### Deployment Strategies: Rolling vs Blue/Green

ECS supports two primary deployment strategies, each with different tradeoffs for availability, rollback speed, and infrastructure costs.

**Rolling Deployment** is the default. New tasks start running the new image while old tasks continue running the old image. Gradually, the old tasks are replaced by new ones. This means your service never experiences a complete outage—there's always capacity handling requests. However, there's a period where both old and new versions are running, which can complicate testing and database migrations. Rolling deployments also mean that if a bug makes it through your testing, users will see errors during the rollout until all tasks are updated.

To use rolling deployment with ECS, configure the service with a `minimumHealthyPercent` greater than 50. For example, a setting of 100 means ECS will launch new tasks before terminating old ones, maintaining full capacity throughout the rollout. A setting of 75 means ECS can temporarily reduce capacity to 75% during the rollout, which saves money but risks service degradation if that capacity is actually needed.

**Blue/Green Deployment** is more sophisticated. The "blue" environment is your current production. The "green" environment is a completely separate set of infrastructure running the new version. Once the new version is fully deployed and tested, you flip traffic from blue to green. If something goes wrong, you flip back to blue. This approach provides instant rollback and zero-downtime deployment, but requires double the infrastructure temporarily and introduces additional moving parts.

With ECS, blue/green deployments are typically orchestrated through CodeDeploy, which is CloudFormation-compatible. When you select CodeDeploy as your deployment provider in CodePipeline and configure it with a blue/green strategy, CodeDeploy creates a new ECS service (the green environment), validates that it's healthy, then updates your load balancer to route traffic to it.

Here's when to use each strategy:

Use rolling deployment when your application is tolerant of brief periods running multiple versions. It's simpler to manage and uses fewer resources. It works well for stateless services, background workers, and APIs where occasional version mismatches aren't problematic.

Use blue/green deployment when you need zero-downtime updates, when you need instant rollback capability, when you have complex database migrations that need to happen atomically, or when you're deploying to a service where backward compatibility isn't guaranteed. The extra infrastructure cost and orchestration complexity are worth it for critical services.

### Putting It All Together: A Complete Example

Let's walk through a concrete scenario. You've created a CodeCommit repository with a simple Node.js application. Your `package.json` looks normal. Your `Dockerfile` is straightforward—a multi-stage build that installs dependencies and runs the app on port 3000. Your `buildspec.yml` follows the template we discussed earlier.

A developer commits code and pushes it to the main branch. CodePipeline detects the change (via EventBridge) and immediately triggers the pipeline. CodeBuild pulls the source code, runs the build steps, builds a Docker image, authenticates with ECR, and pushes the image. It generates the `imagedefinitions.json` artifact and uploads it to an S3 bucket that CodePipeline is watching.

CodePipeline then moves to the deploy stage. It reads the `imagedefinitions.json` file, which contains the new image URI. If you're using rolling deployment, ECS updates the service, which pulls the new image from ECR and starts new tasks. Old tasks are gradually replaced. If you're using blue/green via CodeDeploy, CodeDeploy creates a new ECS service with the new image, waits for it to become healthy, then updates the load balancer.

Within minutes, the new code is running in production. If something goes wrong and you need to rollback, you either trigger a new pipeline run with the previous commit (for rolling) or manually revert traffic in CodeDeploy (for blue/green).

This entire process is automated, traceable, and repeatable. Every deployment leaves an audit trail in CodePipeline and CloudWatch logs.

### Troubleshooting Common Issues

Even with careful configuration, pipelines sometimes stumble. Here are the most common issues and how to diagnose them:

**CodeBuild fails with "permission denied" errors:** Check that the CodeBuild service role has `ecr:PutImage` and related permissions. Also verify that the ECR repository exists and that the repository name in your `buildspec.yml` matches exactly.

**Deployment fails with "missing required parameters":** Most commonly, your `imagedefinitions.json` is malformed or missing. Verify that it's being generated in the post_build phase of `buildspec.yml` and that the container name matches what's in your ECS task definition.

**ECS tasks fail to start:** Check ECS CloudWatch logs first—the errors there are usually specific. Common causes include the task execution role lacking ECR pull permissions, the Docker image not being in ECR, or the image being corrupted during the push.

**Pipeline seems to hang:** CodePipeline has service quotas. If you're running many pipelines or large builds, you might hit limits. Check CloudWatch metrics and consider contacting AWS support to increase quotas.

**Images pile up in ECR:** Without a lifecycle policy, ECR repositories grow indefinitely. Configure a lifecycle policy to delete untagged images or images older than a certain age.

### Security Best Practices

As your pipeline matures, a few security considerations become important. First, enable ECR image scanning to check for known vulnerabilities. This can be automated—have CodeBuild fail the build if critical vulnerabilities are found.

Second, use IAM roles with least privilege. We've discussed this, but it's worth reiterating: grant only the permissions each service needs. Don't be tempted to use `*` resources or wildcard actions as a shortcut—it increases your attack surface.

Third, consider secrets management. If your application needs to access databases, APIs, or other services, don't embed credentials in the Docker image. Instead, use AWS Secrets Manager or Parameter Store and inject them at runtime via ECS task definition environment variables or secrets.

Fourth, implement code scanning in your pipeline. Many organizations add a code quality gate between the build stage and the deployment stage, using tools like SonarQube, Snyk, or AWS CodeGuru.

Finally, enable CloudTrail logging for all your pipeline actions. This gives you a complete audit trail of who did what and when.

### Next Steps and Scaling

Once your basic pipeline is working, you'll naturally want to enhance it. Consider adding multiple environments—perhaps a staging deployment that runs blue/green every time and production that runs rolling deployments only on manual approval. CodePipeline supports approval actions that pause the pipeline and require a human to click a button before proceeding.

You might also add automated testing between stages. CodePipeline integrates with CodeBuild, so you could add a post-build phase that runs integration tests or smoke tests against a staging environment.

As you scale, you'll want to implement proper branching strategies. Feature branches can trigger builds to separate repositories, allowing developers to validate changes before they hit main. CodePipeline can support multiple branches triggering separate pipelines, or a single pipeline triggered by multiple branches with conditional deployments.

Container orchestration is the future of software deployment, and a well-constructed CI/CD pipeline is how you unlock that future. With CodePipeline, CodeBuild, ECR, and ECS, you have all the pieces you need.

### Conclusion

Building a CI/CD pipeline with CodeBuild, ECR, and ECS gives you a powerful, scalable, and auditable way to deploy containerized applications. The key to success is understanding each piece: CodeBuild converts your code into a Docker image, ECR stores that image, and ECS runs it. CodePipeline orchestrates the entire process and ensures that every change flows through a consistent, repeatable workflow.

The IAM permissions are crucial but often overlooked—take time to get them right from the start, and you'll avoid hours of debugging later. And when it comes to deployment strategies, choose based on your application's needs: rolling deployments for simplicity and rolling updates for most workloads, blue/green deployments when you need zero-downtime updates and instant rollback.

With this foundation in place, you have a modern deployment pipeline that will serve your team well as your application grows.
