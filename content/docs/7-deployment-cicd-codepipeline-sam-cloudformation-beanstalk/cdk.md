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

{{< qcm >}}
[
{
"question": "What does the AWS CDK use under the hood to provision cloud resources?",
"answers": [
{
"answer": "It directly calls AWS service APIs to create resources.",
"isCorrect": false,
"explanation": "CDK does not call AWS APIs directly. It synthesizes CloudFormation templates and relies on CloudFormation to provision resources."
},
{
"answer": "It generates and deploys CloudFormation templates.",
"isCorrect": true,
"explanation": "CDK is a higher-level abstraction on top of CloudFormation. Running 'cdk deploy' synthesizes a CloudFormation template and then deploys it via CloudFormation."
},
{
"answer": "It uses AWS SAM to manage serverless resources.",
"isCorrect": false,
"explanation": "CDK is independent of SAM. While both can be used for serverless workloads, CDK generates CloudFormation templates, not SAM templates."
},
{
"answer": "It uses Terraform as its underlying deployment engine.",
"isCorrect": false,
"explanation": "CDK uses CloudFormation, not Terraform, as its deployment engine. There is a separate project called CDK for Terraform (cdktf), but the standard AWS CDK targets CloudFormation."
}
]
},
{
"question": "Which programming languages are supported by AWS CDK? (Select THREE)",
"answers": [
{
"answer": "TypeScript",
"isCorrect": true,
"explanation": "TypeScript is one of the supported CDK languages and is often used in CDK documentation examples."
},
{
"answer": "Python",
"isCorrect": true,
"explanation": "Python is a supported CDK language, allowing developers to define infrastructure using Python classes and constructs."
},
{
"answer": "Ruby",
"isCorrect": false,
"explanation": "Ruby is not supported by AWS CDK. The supported languages are TypeScript, Python, Java, C#, and Go."
},
{
"answer": "Go",
"isCorrect": true,
"explanation": "Go is one of the five supported CDK languages alongside TypeScript, Python, Java, and C#."
},
{
"answer": "PHP",
"isCorrect": false,
"explanation": "PHP is not supported by AWS CDK. The supported languages are TypeScript, Python, Java, C#, and Go."
}
]
},
{
"question": "A developer defines a CDK App with two stacks: one for networking resources and one for application resources. What does each Stack correspond to in AWS?",
"answers": [
{
"answer": "Each Stack corresponds to a CloudFormation stack.",
"isCorrect": true,
"explanation": "In CDK, a Stack maps directly to a CloudFormation stack and is the unit of deployment. Multiple stacks can coexist in a single CDK App."
},
{
"answer": "Each Stack corresponds to an AWS Region.",
"isCorrect": false,
"explanation": "A CDK Stack is not tied to a region by default — it maps to a CloudFormation stack. You can deploy stacks to different regions, but the Stack itself is not a region."
},
{
"answer": "Each Stack corresponds to an IAM role.",
"isCorrect": false,
"explanation": "A Stack is a deployment unit that maps to a CloudFormation stack, not to an IAM role."
},
{
"answer": "Each Stack corresponds to a CloudFormation StackSet.",
"isCorrect": false,
"explanation": "A CDK Stack maps to a single CloudFormation stack, not a StackSet. StackSets are used for multi-account/multi-region deployments and are a separate concept."
}
]
},
{
"question": "Which CDK construct level provides a direct, one-to-one mapping to a CloudFormation resource with no defaults, and uses the 'Cfn' prefix?",
"answers": [
{
"answer": "L1 (CloudFormation Resource)",
"isCorrect": true,
"explanation": "L1 constructs are auto-generated from the CloudFormation specification and map exactly to CloudFormation resource types. They are prefixed with 'Cfn' (e.g., CfnBucket) and require all properties to be set explicitly."
},
{
"answer": "L2 (Curated Construct)",
"isCorrect": false,
"explanation": "L2 constructs are higher-level abstractions with sensible defaults and helper methods. They wrap L1 constructs and do not use the 'Cfn' prefix."
},
{
"answer": "L3 (Patterns)",
"isCorrect": false,
"explanation": "L3 constructs (solutions constructs) combine multiple L2 resources to implement full architectural patterns. They are the highest level of abstraction, not a direct CloudFormation mapping."
}
]
},
{
"question": "A developer wants to grant read access to an S3 bucket for a Lambda function without writing IAM policy JSON manually. Which CDK construct level makes this easiest, and how?",
"answers": [
{
"answer": "L2, using helper methods like grantRead() on the bucket construct.",
"isCorrect": true,
"explanation": "L2 constructs like s3.Bucket provide helper methods such as grantRead() that automatically generate and attach the correct IAM policies, removing the need to write policy JSON manually."
},
{
"answer": "L1, using CfnBucket and manually specifying a BucketPolicy resource.",
"isCorrect": false,
"explanation": "L1 constructs require you to define all properties explicitly, including IAM policies. They do not provide helper methods like grantRead()."
},
{
"answer": "L3, by deploying a pre-built pattern that includes S3 and Lambda.",
"isCorrect": false,
"explanation": "L3 patterns can wire services together, but the question asks about the easiest way to grant permissions on an existing bucket. L2 helper methods like grantRead() are the direct answer."
}
]
},
{
"question": "A team is building a CDK application that deploys an Application Load Balancer, an ECS cluster, and a Fargate service all together as a single unit. Which CDK construct level is most appropriate?",
"answers": [
{
"answer": "L3 (Patterns / Solutions Constructs)",
"isCorrect": true,
"explanation": "L3 constructs are designed to implement full architectural patterns by combining multiple L2 resources. A construct like ApplicationLoadBalancedFargateService wires together an ALB, ECS cluster, and Fargate service in one abstraction."
},
{
"answer": "L1 (CloudFormation Resource)",
"isCorrect": false,
"explanation": "L1 constructs map to individual CloudFormation resources and provide no defaults or composition. You would have to manually wire every resource together."
},
{
"answer": "L2 (Curated Construct)",
"isCorrect": false,
"explanation": "L2 constructs represent individual services with sensible defaults, but combining multiple services into a full architectural pattern is the purpose of L3 constructs."
}
]
},
{
"question": "In CDK v2, where do L1 and L2 constructs for all AWS services come from?",
"answers": [
{
"answer": "They are all included in the single 'aws-cdk-lib' package.",
"isCorrect": true,
"explanation": "CDK v2 consolidated all constructs into a single 'aws-cdk-lib' library. Service-specific modules are imported as namespaces (e.g., aws_cdk.aws_s3), and only one dependency and version needs to be managed."
},
{
"answer": "Each AWS service requires a separate npm/pip package to be installed.",
"isCorrect": false,
"explanation": "This was true in CDK v1, which used individual packages per service (e.g., @aws-cdk/aws-s3). CDK v2 consolidated everything into 'aws-cdk-lib'."
},
{
"answer": "L1 constructs are in 'aws-cdk-lib' but L2 constructs require separate packages.",
"isCorrect": false,
"explanation": "Both L1 and L2 constructs ship together in 'aws-cdk-lib'. There is no separation between L1 and L2 at the package level."
},
{
"answer": "Constructs are downloaded at synth time from the AWS CDK registry.",
"isCorrect": false,
"explanation": "Constructs are not downloaded at synth time. They are part of the 'aws-cdk-lib' package installed as a project dependency."
}
]
},
{
"question": "Which CDK CLI command synthesizes your CDK application into a CloudFormation template without deploying it?",
"answers": [
{
"answer": "cdk synth",
"isCorrect": true,
"explanation": "'cdk synth' synthesizes the CDK app into one or more CloudFormation templates and writes them to the cdk.out/ directory. It is the key command for inspecting what CDK will deploy before actually deploying."
},
{
"answer": "cdk deploy",
"isCorrect": false,
"explanation": "'cdk deploy' both synthesizes and deploys the stack to AWS. It does not stop at synthesis — it triggers a CloudFormation deployment."
},
{
"answer": "cdk diff",
"isCorrect": false,
"explanation": "'cdk diff' compares the local CDK app against the currently deployed stack and shows what will change. It does not produce a synthesized template in cdk.out/."
},
{
"answer": "cdk init",
"isCorrect": false,
"explanation": "'cdk init' scaffolds a new CDK project. It has nothing to do with synthesizing templates."
}
]
},
{
"question": "A developer runs 'cdk deploy' for the first time in a new AWS account and region, and the command fails with an error saying the environment is not bootstrapped. What must they do first?",
"answers": [
{
"answer": "Run 'cdk bootstrap aws://ACCOUNT_ID/REGION' to provision the required CDK resources.",
"isCorrect": true,
"explanation": "Bootstrapping provisions the S3 bucket, ECR repository, and IAM roles that CDK needs to deploy. It must be done once per account/region combination before the first deployment."
},
{
"answer": "Create an S3 bucket manually and configure it in cdk.json.",
"isCorrect": false,
"explanation": "The 'cdk bootstrap' command handles the creation of the required S3 bucket and other resources automatically. Manual creation is not the correct approach."
},
{
"answer": "Run 'cdk synth' first, then retry 'cdk deploy'.",
"isCorrect": false,
"explanation": "Running 'cdk synth' does not bootstrap the environment. The bootstrapping step requires running 'cdk bootstrap'."
},
{
"answer": "Add an environment block to the CDK App with the account and region.",
"isCorrect": false,
"explanation": "Specifying the environment in the CDK App does not bootstrap it. Bootstrapping is a separate, one-time step using the 'cdk bootstrap' command."
}
]
},
{
"question": "What resources does CDK bootstrapping provision in the target AWS account? (Select TWO)",
"answers": [
{
"answer": "An S3 bucket for staging deployment assets such as Lambda zip files.",
"isCorrect": true,
"explanation": "The bootstrap process creates an S3 bucket used to store assets (like Lambda deployment packages) that CDK needs to deploy the application."
},
{
"answer": "An ECR repository for container images.",
"isCorrect": true,
"explanation": "CDK bootstrapping also creates an Amazon ECR repository, used when CDK applications include Docker-based assets such as Lambda container images or ECS tasks."
},
{
"answer": "A default VPC for CDK deployments.",
"isCorrect": false,
"explanation": "CDK bootstrapping does not create a VPC. It provisions the S3 bucket, ECR repository, and IAM roles needed by the CDK deployment mechanism."
},
{
"answer": "A CloudTrail trail to audit CDK deployments.",
"isCorrect": false,
"explanation": "CloudTrail is not part of CDK bootstrapping. Bootstrapping focuses on S3, ECR, and IAM roles required for deployments."
}
]
},
{
"question": "After running 'cdk synth', where is the synthesized CloudFormation template written?",
"answers": [
{
"answer": "The cdk.out/ directory.",
"isCorrect": true,
"explanation": "'cdk synth' writes the synthesized CloudFormation template(s) to the cdk.out/ directory. This output can be inspected to verify what CDK will deploy."
},
{
"answer": "The .aws/ directory in the user's home folder.",
"isCorrect": false,
"explanation": "The .aws/ directory stores AWS CLI credentials and config, not CDK synthesized templates. CDK writes to cdk.out/."
},
{
"answer": "An S3 bucket automatically created by CDK.",
"isCorrect": false,
"explanation": "The template is written locally to the cdk.out/ directory. Assets may be uploaded to S3 during deployment, but the synthesized template itself is a local file."
},
{
"answer": "A CloudFormation template is stored in AWS Systems Manager Parameter Store.",
"isCorrect": false,
"explanation": "CDK does not store synthesized templates in Parameter Store. They are written to the cdk.out/ directory on the local filesystem."
}
]
},
{
"question": "Which CDK CLI command allows a developer to preview the changes that will be applied to a deployed stack before actually deploying?",
"answers": [
{
"answer": "cdk diff",
"isCorrect": true,
"explanation": "'cdk diff' compares the local CDK application against the currently deployed CloudFormation stack and shows a diff of what will be added, modified, or removed."
},
{
"answer": "cdk synth",
"isCorrect": false,
"explanation": "'cdk synth' produces the CloudFormation template but does not compare it against the deployed stack. It does not show a diff of changes."
},
{
"answer": "cdk deploy --dry-run",
"isCorrect": false,
"explanation": "There is no '--dry-run' flag for 'cdk deploy'. The correct command for previewing changes is 'cdk diff'."
},
{
"answer": "cdk validate",
"isCorrect": false,
"explanation": "'cdk validate' is not a standard CDK CLI command. Use 'cdk diff' to preview changes against a deployed stack."
}
]
},
{
"question": "A developer needs to tear down all AWS resources created by a CDK stack. Which command should they use?",
"answers": [
{
"answer": "cdk destroy",
"isCorrect": true,
"explanation": "'cdk destroy' deletes the deployed CloudFormation stack and all its resources. It respects any RemovalPolicy settings defined on individual resources."
},
{
"answer": "cdk delete",
"isCorrect": false,
"explanation": "'cdk delete' is not a valid CDK CLI command. The correct command to remove a deployed stack is 'cdk destroy'."
},
{
"answer": "cdk deploy --rollback",
"isCorrect": false,
"explanation": "'--rollback' is not a teardown option. To delete all stack resources, the correct command is 'cdk destroy'."
},
{
"answer": "cdk synth --delete",
"isCorrect": false,
"explanation": "There is no '--delete' flag for 'cdk synth'. 'cdk synth' only synthesizes templates; it does not interact with deployed stacks."
}
]
},
{
"question": "A company wants to build a CI/CD pipeline that automatically updates itself when the CDK pipeline code changes, including adding new deployment stages. Which CDK feature should they use?",
"answers": [
{
"answer": "CDK Pipelines (self-mutating pipeline)",
"isCorrect": true,
"explanation": "CDK Pipelines is a high-level construct for CI/CD that is self-mutating — the pipeline can update its own structure when the CDK code changes. Adding a new stage is just a code change that the pipeline picks up on the next run."
},
{
"answer": "AWS CodeDeploy with a manually maintained buildspec.yml",
"isCorrect": false,
"explanation": "CodeDeploy handles deployment automation but is not self-mutating for pipeline structure changes. CDK Pipelines provides the self-mutation capability natively."
},
{
"answer": "A standard CodePipeline defined with L1 CDK constructs",
"isCorrect": false,
"explanation": "A standard CodePipeline built with L1 constructs would not be self-mutating. CDK Pipelines adds the self-mutation behavior on top of CodePipeline."
},
{
"answer": "AWS Elastic Beanstalk environments chained with EventBridge rules",
"isCorrect": false,
"explanation": "Elastic Beanstalk and EventBridge do not provide a self-mutating pipeline. CDK Pipelines is the correct feature for this use case."
}
]
},
{
"question": "CDK Pipelines is built on top of which two AWS services?",
"answers": [
{
"answer": "AWS CodePipeline and AWS CodeBuild",
"isCorrect": true,
"explanation": "CDK Pipelines uses CodePipeline as the pipeline orchestrator and CodeBuild for the synth step and any build/test actions. This allows it to integrate naturally with the broader AWS developer tooling ecosystem."
},
{
"answer": "AWS CodeDeploy and AWS CodeCommit",
"isCorrect": false,
"explanation": "CodeCommit can be a source stage in CDK Pipelines, and CodeDeploy can be part of deployment, but CDK Pipelines itself is built on CodePipeline and CodeBuild."
},
{
"answer": "AWS Step Functions and AWS Lambda",
"isCorrect": false,
"explanation": "CDK Pipelines does not use Step Functions or Lambda as its underlying engine. It is built on CodePipeline and CodeBuild."
},
{
"answer": "AWS Amplify and AWS AppConfig",
"isCorrect": false,
"explanation": "Amplify and AppConfig are unrelated to CDK Pipelines. CDK Pipelines is built on CodePipeline and CodeBuild."
}
]
},
{
"question": "What is the role of the 'App' in a CDK project?",
"answers": [
{
"answer": "It is the root entry point that CDK synthesizes into one or more CloudFormation templates.",
"isCorrect": true,
"explanation": "The App is the top-level construct in a CDK project. When 'cdk synth' or 'cdk deploy' is run, the App is synthesized into CloudFormation templates — one per Stack defined within it."
},
{
"answer": "It is the equivalent of a CloudFormation stack.",
"isCorrect": false,
"explanation": "A Stack, not an App, maps to a CloudFormation stack. The App is a higher-level container that can hold multiple stacks."
},
{
"answer": "It is a construct that creates an Elastic Beanstalk application.",
"isCorrect": false,
"explanation": "The CDK App has nothing to do with Elastic Beanstalk. It is the root entry point of the CDK program."
},
{
"answer": "It defines the IAM permissions used during CDK deployment.",
"isCorrect": false,
"explanation": "IAM permissions used during deployment are configured via bootstrapping (CDK bootstrap roles), not by the App construct."
}
]
},
{
"question": "Which of the following statements about CDK and CloudFormation are correct? (Select TWO)",
"answers": [
{
"answer": "CDK always deploys through CloudFormation — it never bypasses it.",
"isCorrect": true,
"explanation": "CDK is a higher-level abstraction on top of CloudFormation. Every deployment synthesizes a standard CloudFormation template, and all CloudFormation concepts (change sets, rollbacks, stack events) still apply."
},
{
"answer": "The synthesized CloudFormation template is standard JSON that can be inspected.",
"isCorrect": true,
"explanation": "The output of 'cdk synth' is a standard CloudFormation JSON template in the cdk.out/ directory. It can be read and verified directly, which is useful for debugging L1-level details."
},
{
"answer": "CDK replaces CloudFormation and does not rely on it.",
"isCorrect": false,
"explanation": "CDK does not replace CloudFormation. It is a higher-level abstraction that generates and deploys CloudFormation templates. CloudFormation remains the underlying deployment engine."
},
{
"answer": "CDK synthesizes Terraform configurations, not CloudFormation templates.",
"isCorrect": false,
"explanation": "Standard AWS CDK synthesizes CloudFormation templates. CDK for Terraform (cdktf) is a separate project; the AWS CDK targets CloudFormation."
}
]
},
{
"question": "A developer wants to start a new CDK project in Python. Which CDK CLI command should they run first?",
"answers": [
{
"answer": "cdk init",
"isCorrect": true,
"explanation": "'cdk init' scaffolds a new CDK project in the chosen language. Running it in an empty directory with the '--language python' option generates the project structure, entry point, and dependencies."
},
{
"answer": "cdk synth",
"isCorrect": false,
"explanation": "'cdk synth' synthesizes an existing CDK app into a CloudFormation template. It cannot be used to bootstrap a new project from scratch."
},
{
"answer": "cdk bootstrap",
"isCorrect": false,
"explanation": "'cdk bootstrap' prepares an AWS account/region for CDK deployments. It does not scaffold a new project."
},
{
"answer": "cdk deploy",
"isCorrect": false,
"explanation": "'cdk deploy' deploys an existing CDK app to AWS. It is not used to create a new project."
}
]
}
]
{{< /qcm >}}