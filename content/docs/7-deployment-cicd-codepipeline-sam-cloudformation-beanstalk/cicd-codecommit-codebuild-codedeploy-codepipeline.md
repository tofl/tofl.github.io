---
title: "19. CI/CD (CodeCommit, CodeBuild, CodeDeploy, CodePipeline)"
type: docs
weight: 1
---

## CI/CD (CodeCommit, CodeBuild, CodeDeploy, CodePipeline)

Manual deployments are slow, inconsistent, and error-prone. When every release requires a developer to SSH into a server, run scripts by hand, or remember the exact sequence of steps, mistakes happen — and scaling that process across teams and environments becomes untenable. AWS provides a suite of managed services — **CodeCommit**, **CodeBuild**, **CodeDeploy**, and **CodePipeline** — that together let you automate the entire path from a code commit to a production deployment. This is the foundation of a modern CI/CD (Continuous Integration / Continuous Delivery) pipeline on AWS.

### CodeCommit

CodeCommit [🔗](https://docs.aws.amazon.com/codecommit/latest/userguide/welcome.html) is a fully managed, private Git repository service. It works exactly like GitHub or Bitbucket, but is hosted within AWS and integrates natively with IAM for access control — no need to manage SSH keys or tokens outside of AWS.

Key concepts to know for the exam:

- **Repositories** are the core unit. You create one per project, clone it locally via HTTPS or SSH, and push/pull branches just like any Git workflow.
- **Branch policies** let you require pull request approvals before merging, preventing direct pushes to protected branches like `main`.
- **Triggers** allow you to invoke an SNS topic or Lambda function on repository events (e.g., a push to a branch). This is how you can kick off a pipeline or notification automatically.

> **Note:** AWS announced in July 2024 that CodeCommit is no longer available to new customers. Existing customers can continue using it, and it remains on the DVA-C02 exam. For new projects, AWS recommends using **CodeStar Connections** to connect to GitHub or Bitbucket instead (covered below).

### CodeBuild

CodeBuild [🔗](https://docs.aws.amazon.com/codebuild/latest/userguide/welcome.html) is a fully managed build service. It compiles your source code, runs tests, and produces deployable artifacts — without you having to provision or manage any build servers. You pay only for the compute time used during builds.

The heart of CodeBuild is the **`buildspec.yml`** file [🔗](https://docs.aws.amazon.com/codebuild/latest/userguide/build-spec-ref.html), placed at the root of your repository. It defines what CodeBuild does during a build. Its structure follows a set of **phases**:

```yaml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 18
    commands:
      - echo "Installing dependencies"
      - npm install
  pre_build:
    commands:
      - echo "Running tests"
      - npm test
  build:
    commands:
      - echo "Building the app"
      - npm run build
  post_build:
    commands:
      - echo "Build complete"

artifacts:
  files:
    - '**/*'
  base-directory: dist

cache:
  paths:
    - node_modules/**/*
```

- **`install`** — sets up the runtime and installs tools.
- **`pre_build`** — runs before the main build, typically for tests or auth steps.
- **`build`** — the core compilation or packaging step.
- **`post_build`** — cleanup, notifications, or pushing images to ECR.
- **`artifacts`** — defines what files to package and hand off to the next stage (e.g., CodeDeploy or S3).
- **`cache`** — specifies paths (like `node_modules`) to cache in S3 between builds to speed things up significantly.

**Environment variables** can be injected into a build either as plaintext in the project configuration, or as references to **SSM Parameter Store** or **Secrets Manager** for sensitive values [🔗](https://docs.aws.amazon.com/codebuild/latest/userguide/build-env-ref-env-vars.html). Inside `buildspec.yml`, you reference them as standard shell variables: `$MY_VAR`.

### CodeDeploy

CodeDeploy [🔗](https://docs.aws.amazon.com/codedeploy/latest/userguide/welcome.html) automates application deployments to a variety of compute targets. Unlike CodeBuild (which builds) or CodePipeline (which orchestrates), CodeDeploy's sole job is to get your built artifact onto the target and run it safely.

**Deployment targets:**

- **EC2 / On-Premises** — deploys to instances running the CodeDeploy agent. This covers both AWS-managed EC2 instances and physical servers in your own data center.
- **Lambda** — shifts traffic between Lambda function versions using aliases.
- **ECS** — replaces task definitions in an ECS service with a new version.

#### The AppSpec File

Every CodeDeploy deployment is driven by an **`appspec.yml`** [🔗](https://docs.aws.amazon.com/codedeploy/latest/userguide/reference-appspec-file.html) file at the root of your deployment bundle. It tells CodeDeploy where to put files and which scripts to run at each point in the deployment.

For an EC2 deployment, it looks like this:

```yaml
version: 0.0
os: linux

files:
  - source: /build
    destination: /var/www/myapp

hooks:
  BeforeInstall:
    - location: scripts/stop_server.sh
      timeout: 60
  AfterInstall:
    - location: scripts/install_deps.sh
  ApplicationStart:
    - location: scripts/start_server.sh
  ValidateService:
    - location: scripts/health_check.sh
      timeout: 30
```

The **lifecycle hooks** are the key concept — they let you inject shell scripts at precise moments in the deployment: before files are copied, after they land, when the app starts, and during validation. For Lambda and ECS deployments, the hooks are different (e.g., `BeforeAllowTraffic`, `AfterAllowTraffic`) because the deployment model is traffic-shifting rather than file-copying [🔗](https://docs.aws.amazon.com/codedeploy/latest/userguide/reference-appspec-file-structure-hooks.html).

#### Deployment Configurations

For **EC2/On-Premises**, CodeDeploy controls how many instances are updated at once:

- **AllAtOnce** — deploys to all instances simultaneously. Fastest, but causes downtime if something goes wrong.
- **HalfAtATime** — deploys to half the fleet at once. Maintains partial availability.
- **OneAtATime** — deploys to one instance at a time. Slowest, but safest — production traffic keeps flowing on the rest of the fleet.

You can also define custom configurations specifying a minimum healthy host percentage.

#### Lambda Deployment Strategies

For Lambda, CodeDeploy shifts traffic between the old and new function versions using an **alias**. The strategies are:

- **AllAtOnce** — switches 100% of traffic to the new version immediately.
- **Canary** — shifts a small percentage (e.g., 10%) to the new version first, waits for a bake period, then shifts the remaining 90% — or rolls back automatically if a CloudWatch alarm fires.
- **Linear** — shifts traffic in equal increments over time (e.g., 10% more every 10 minutes) until 100% is on the new version.

Canary and Linear are the safe deployment strategies — they let you validate the new version under real traffic before fully committing. This integrates naturally with SAM, which uses CodeDeploy under the hood for Lambda traffic shifting (covered in the SAM section).

### CodePipeline

CodePipeline [🔗](https://docs.aws.amazon.com/codepipeline/latest/userguide/welcome.html) is the orchestration layer that ties all the other services together. It defines the full release workflow as a sequence of **stages**, each composed of one or more **actions**.

A typical pipeline looks like: