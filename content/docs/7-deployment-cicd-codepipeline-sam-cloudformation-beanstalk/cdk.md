---
title: "22. CDK"
type: docs
weight: 4
---

## CDK (Cloud Development Kit)

The AWS Cloud Development Kit (CDK) is an open-source framework that lets you define cloud infrastructure using familiar programming languages — TypeScript, Python, Java, C#, and Go — instead of writing raw YAML or JSON templates. It solves a real pain point: CloudFormation templates are verbose, hard to reuse, and lack the abstraction tools developers rely on (loops, conditionals, functions, classes). CDK brings those tools back. Under the hood, CDK still generates and deploys CloudFormation — it's a higher-level abstraction on top of it, not a replacement. [🔗](https://docs.aws.amazon.com/cdk/v2/guide/home.html)

### Core Concepts: App, Stack, and Constructs

Every CDK project is organized around three building blocks.

An **App** is the root of your CDK program. It's the entry point that CDK synthesizes into one or more CloudFormation templates. A **Stack** maps directly to a CloudFormation stack — it's the unit of deployment. You can define multiple stacks inside one App, which is useful for separating concerns (e.g., a networking stack and an application stack). [🔗](https://docs.aws.amazon.com/cdk/v2/guide/apps.html)

**Constructs** are the core abstraction in CDK — they represent a cloud component. They come in three levels:

- **L1 (CloudFormation Resource)** — A direct, one-to-one mapping to a CloudFormation resource type. These are auto-generated from the CloudFormation spec and prefixed with `Cfn` (e.g., `CfnBucket`). You get no defaults; you control every property explicitly.
- **L2 (Curated Construct)** — Higher-level abstractions with sensible defaults, helper methods, and built-in security best practices. For example, `s3.Bucket` is an L2 construct that wraps `CfnBucket` and provides methods like `grantRead()` to manage IAM permissions without writing policy JSON.
- **L3 (Patterns)** — Also called *solutions constructs*, these combine multiple L2 resources to implement a full architectural pattern (e.g., an `ApplicationLoadBalancedFargateService` that wires an ALB, ECS cluster, and Fargate service together). [🔗](https://docs.aws.amazon.com/cdk/v2/guide/constructs.html)

In practice, you'll spend most of your time with L2 constructs. Here's a minimal Python example that creates an S3 bucket with versioning:

```python
from aws_cdk import App, Stack
from aws_cdk import aws_s3 as s3
from constructs import Construct

class MyStack(Stack):
    def __init__(self, scope: Construct, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)
        s3.Bucket(self, "MyBucket", versioned=True)

app = App()
MyStack(app, "MyStack")
app.synth()
```

### The Constructs Library

All L1 and L2 constructs ship in the `aws-cdk-lib` package (CDK v2 consolidated everything into a single library). You import service-specific modules as namespaces, such as `aws_cdk.aws_s3`, `aws_cdk.aws_lambda`, or `aws_cdk.aws_dynamodb`. This means one dependency, one version to manage. [🔗](https://docs.aws.amazon.com/cdk/api/v2/)

### CDK CLI

The CDK CLI is the primary tool for working with CDK projects. The key commands you need to know:

- **`cdk init`** — Scaffolds a new CDK project in your chosen language.
- **`cdk synth`** — Synthesizes your CDK app into a CloudFormation template and prints it to stdout (or writes it to the `cdk.out/` directory). This is the most important command to understand — it reveals exactly what CDK will deploy.
- **`cdk diff`** — Compares your local CDK app against the currently deployed stack and shows what will change. Essential before any deployment.
- **`cdk deploy`** — Synthesizes and deploys the stack(s) to AWS. CDK calls CloudFormation on your behalf.
- **`cdk destroy`** — Tears down the deployed stack and deletes all its resources (respecting any `RemovalPolicy` you've set).

[🔗](https://docs.aws.amazon.com/cdk/v2/guide/cli.html)

### CDK Bootstrapping

Before you can deploy a CDK app into an AWS account and region for the first time, you must **bootstrap** the environment. Bootstrapping provisions a set of resources CDK needs to operate — primarily an S3 bucket (for staging assets like Lambda zip files) and an ECR repository, along with the IAM roles CDK uses to perform deployments.

```bash
cdk bootstrap aws://ACCOUNT_ID/REGION
```

You only need to do this once per account/region combination. If you try to deploy without bootstrapping, CDK will tell you the environment is not bootstrapped. [🔗](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping.html)

### CDK Output: The Synthesized Template

Running `cdk synth` produces a CloudFormation template in the `cdk.out/` directory. This is a critical thing to understand for both the exam and real-world use: **CDK does not deploy directly — it always goes through CloudFormation**. The synthesized template is standard CloudFormation JSON, which means all the CloudFormation concepts (change sets, stack events, rollbacks) still apply. You can inspect the synthesized template to verify that CDK is generating exactly what you expect, which is especially useful when debugging L1-level details.

### CDK Pipelines (Self-Mutating Pipeline)

CDK Pipelines is a high-level construct for building CI/CD pipelines that deploy CDK applications. What makes it notable is that it's **self-mutating** — the pipeline can update itself when you change your CDK code, including changes to the pipeline's own structure. This means adding a new stage to your pipeline is just a code change; the pipeline picks it up on the next run.

A CDK Pipelines setup typically involves:
1. A source stage (e.g., CodeCommit or GitHub via CodeStar Connections)
2. A synth step that runs `cdk synth`
3. One or more deployment stages, each targeting an environment (dev, staging, prod)

CDK Pipelines is built on top of CodePipeline and CodeBuild, so it integrates naturally with the rest of the AWS developer tooling you'll see in this phase. [🔗](https://docs.aws.amazon.com/cdk/v2/guide/cdk_pipeline.html)