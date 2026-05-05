---
title: "Amplify CLI vs CDK vs CloudFormation: Choosing the Right IaC Tool"
---

## Amplify CLI vs CDK vs CloudFormation: Choosing the Right IaC Tool

When you're building applications on AWS, you'll quickly encounter a familiar problem: too many ways to accomplish the same goal. Want to provision infrastructure? You could reach for AWS Amplify CLI, the AWS Cloud Development Kit, or write raw CloudFormation templates. Each approach will technically work, but they're designed for fundamentally different scenarios and different types of developers. Understanding these differences isn't just academically interesting—it directly affects your project's timeline, maintainability, and your team's happiness.

In this article, we'll untangle the confusion between these three infrastructure-as-code tools by examining their abstraction levels, underlying mechanics, trade-offs, and most importantly, when each one makes sense. By the end, you'll be able to make confident decisions about which tool fits your specific context, and you'll understand how to migrate between them if your needs evolve.

### Understanding the Abstraction Pyramid

Before we compare these tools directly, it helps to visualize them in terms of abstraction level. Think of AWS infrastructure provisioning as a pyramid with CloudFormation at the base.

CloudFormation is the foundation—AWS's native declarative infrastructure language. Every single resource that exists in AWS has a corresponding CloudFormation representation. When you write a CloudFormation template, you're essentially speaking AWS's native language. It's powerful and comprehensive, but it's also verbose and requires deep knowledge of resource properties and relationships.

AWS CDK sits in the middle of this pyramid. It's an abstraction layer that generates CloudFormation templates on your behalf. When you write CDK code (typically in TypeScript, Python, Java, or Go), you're using higher-level constructs that represent common infrastructure patterns. The CDK synthesizes your code into CloudFormation behind the scenes—you never write raw YAML or JSON, but that's ultimately what gets deployed.

AWS Amplify CLI perches at the top of the pyramid. It's the highest level of abstraction, specifically designed for full-stack developers building web and mobile applications. Amplify CLI generates CDK code, which then generates CloudFormation, which finally gets deployed to AWS. It's abstractions all the way down, but for a specific use case: connecting frontend applications to backend services.

Understanding this pyramid is crucial because it explains why these tools exist and why you might choose one over another.

### CloudFormation: The Foundational Layer

Let's start with CloudFormation, the most direct approach to infrastructure-as-code on AWS. A CloudFormation template is a JSON or YAML file that describes your entire infrastructure—every resource, its properties, outputs, and dependencies.

Consider a simple example: deploying an S3 bucket with CloudFormation looks like this:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Simple S3 bucket template'
Resources:
  MyBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: my-unique-bucket-name
      VersioningConfiguration:
        Status: Enabled
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
Outputs:
  BucketName:
    Value: !Ref MyBucket
    Description: Name of the S3 bucket
```

CloudFormation's primary strength is its universality. It can provision virtually any AWS resource because AWS maintains comprehensive CloudFormation documentation for all its services. It's also battle-tested and mature—organizations have been using CloudFormation for over a decade.

However, CloudFormation templates quickly become unwieldy. A moderately complex application might require hundreds of lines of YAML with repetitive property declarations. There's minimal code reuse without significant manual templating. Property names are verbose (think `AWS::Lambda::Function` instead of just `Function`). If you need to deploy the same infrastructure pattern multiple times, you're either duplicating YAML or creating nested stacks, both of which complicate maintenance.

CloudFormation is also declarative without being particularly expressive. You describe what you want, but you can't easily introduce loops, conditionals, or other programming constructs. You can use CloudFormation parameters and pseudo-parameters, but it feels like writing infrastructure in a restricted DSL rather than a full programming language.

CloudFormation shines when you need maximum control and visibility into every resource property, when you're working with niche AWS services that higher-level tools haven't abstracted yet, or when you need to meet specific compliance or governance requirements that demand explicit YAML/JSON templates.

### AWS CDK: The Programming Language Approach

The AWS Cloud Development Kit takes a fundamentally different philosophy: let developers write infrastructure code in a real programming language. CDK is available in multiple languages including TypeScript, Python, Java, C#, and Go. You write imperative code that defines your infrastructure, and the CDK synthesizes it into CloudFormation templates.

Here's that same S3 bucket in CDK using Python:

```python
from aws_cdk import (
    aws_s3 as s3,
    core
)

class MyStack(core.Stack):
    def __init__(self, scope: core.Construct, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)
        
        bucket = s3.Bucket(self, "MyBucket",
            bucket_name="my-unique-bucket-name",
            versioned=True,
            block_public_access=s3.BlockPublicAccess(
                block_public_acls=True,
                block_public_policy=True,
                ignore_public_acls=True,
                restrict_public_buckets=True
            )
        )
```

The difference is immediately apparent. CDK code is more concise, more readable, and more maintainable. Property names are more intuitive (`versioned` instead of `VersioningConfiguration.Status`). You can use loops, conditionals, and functions—all the tools a programming language provides.

CDK introduces the concept of constructs, which are reusable components. A Level 1 construct maps directly to a CloudFormation resource, but Level 2 and Level 3 constructs are higher-level abstractions that bundle multiple resources together. For example, a Level 3 construct might create an S3 bucket, configure it for static website hosting, set up a CloudFront distribution, and attach an SSL certificate—all from a single construct. This dramatically reduces boilerplate and encourages best practices.

The beauty of CDK is that it maintains a direct connection to CloudFormation's capabilities. You can always drop down to lower-level constructs or even raw JSON when you need specific behavior. This flexibility makes CDK appropriate for infrastructure engineers, platform teams, and full-stack developers with infrastructure responsibilities.

However, CDK introduces its own learning curve. You need to understand the CDK object model, how constructs relate to one another, and the difference between resource-level and stack-level properties. For frontend developers who just want to add a database to their app, this might feel like overkill.

CDK is also slightly less transparent than raw CloudFormation. When you synthesize a CDK app, it generates CloudFormation templates, but the generated YAML is machine-optimized rather than human-friendly. If you need to audit the exact resources being created, you'll be reading through synthesized CloudFormation rather than code you wrote directly.

### AWS Amplify CLI: Purpose-Built for Full-Stack Developers

Now we arrive at AWS Amplify CLI, the highest-level abstraction in this comparison. Amplify CLI is specifically designed for developers building web and mobile applications on AWS. It abstracts away infrastructure concerns and focuses on the capabilities developers actually need: authentication, databases, APIs, hosting, storage, and real-time features.

Using Amplify CLI, you provision resources by asking "What do I need?" rather than "How do I provision this in CloudFormation?" For example, adding authentication to your application looks like this:

```bash
amplify add auth
```

The CLI walks you through interactive prompts asking about your authentication requirements. Should users sign in with email or username? Do you want multi-factor authentication? Should you use Amazon Cognito or a third-party provider? Once you answer these questions, Amplify CLI generates the necessary backend infrastructure, frontend configuration, and even boilerplate code for your application.

Amplify CLI generates CloudFormation (via CDK) under the hood, but you never interact with that layer directly. When you run `amplify push`, it deploys your infrastructure to AWS. If you run `amplify pull`, it downloads the infrastructure configuration from an existing deployment into your local environment.

The magic of Amplify CLI lies in its opinionated defaults. It makes assumptions about best practices based on common application patterns. An Amplify-generated Cognito user pool comes pre-configured with strong password policies, secure token handling, and appropriate session timeouts. An API generated through Amplify automatically gets CORS configuration that works with your frontend. A database comes with basic backup and encryption settings enabled by default.

This is a massive advantage if you're a frontend developer who wants to focus on your application logic rather than infrastructure minutiae. Amplify CLI gets you productive within minutes, not hours. It also provides frontend libraries and code generation that integrate seamlessly with your backend—your TypeScript SDK automatically reflects your API schema, for instance.

However, Amplify CLI's opinionated nature becomes a constraint when you need to deviate from its assumptions. Want to configure a custom Cognito attribute or a non-standard DynamoDB access pattern? You'll need to exit the Amplify abstraction and manually edit CloudFormation or CDK code. This is possible (Amplify stores generated code in your repository), but it breaks the abstraction and complicates future deployments.

Amplify CLI also covers a narrower scope of AWS services. It specializes in application backend services—compute, databases, APIs, authentication, hosting—but doesn't directly support specialized services like Redshift, ElastiCache, or managed Kubernetes clusters. For those, you'd need to supplement Amplify with other infrastructure tools.

Amplify CLI is ideal for frontend developers, early-stage startups, and teams building straightforward full-stack applications. It's less suitable for enterprises with complex infrastructure requirements or teams that need fine-grained control over every AWS service involved in their stack.

### The Underlying Mechanics: How They Connect

Understanding how these tools relate to each other is essential to making good decisions. The relationship isn't competitive—it's hierarchical and complementary.

When you write CDK code, the `cdk synth` command converts your TypeScript (or other language) code into CloudFormation templates. These templates are valid CloudFormation that can be deployed with `cdk deploy`, but they can also be exported and used with other tools like Terraform or CloudFormation directly.

When you use Amplify CLI, it generates CDK code internally. You can see this by exploring the `amplify/backend` directory in your project—you'll find CDK constructs defining your Cognito user pools, DynamoDB tables, and other resources. When you run `amplify push`, it executes the underlying CDK synthesis and deployment.

This means your Amplify-generated infrastructure is ultimately CloudFormation. You can view the generated templates by running `amplify status` and looking at the CloudFormation stack in the AWS console. This transparency is actually valuable—if you ever need to move away from Amplify, your infrastructure already exists as standard CloudFormation and CDK, so migration is theoretically straightforward.

This layering also means you can mix these tools. An Amplify project can reference CDK stacks. A CDK project can invoke Amplify-generated resources. A CloudFormation template can reference other CloudFormation stacks. AWS is sophisticated about managing these dependencies.

### Trade-offs: Speed vs. Flexibility

The fundamental trade-off in choosing between these tools is speed of development versus flexibility.

Amplify CLI prioritizes speed. A frontend developer can provision a production-ready authentication system in minutes. The interactive prompts guide you toward sensible decisions. The generated code is idiomatic for the frameworks you're already using. This is powerful when you're prototyping or building within Amplify's supported use cases.

But this speed comes at the cost of flexibility. Once you venture outside Amplify's defaults, you're fighting the abstraction. Need to customize your Cognito user pool with domain-specific attributes? Possible, but awkward. Want to implement a complex authorization pattern with multiple user groups and role-based access control? You can do it, but you're no longer using the streamlined Amplify flow.

CDK offers a middle ground. It's more flexible than Amplify while remaining more productive than CloudFormation. You can express complex infrastructure patterns concisely. You can create reusable constructs that encapsulate your organization's infrastructure standards. But you do need to understand AWS services and CDK's programming model. There's a learning curve, and a misstep is less forgiving than Amplify's guided experience.

CloudFormation offers maximum flexibility but demands the most effort. You have complete control over every resource property, but you're writing boilerplate YAML. You can express any AWS capability, but you're responsible for understanding those capabilities and their interactions.

Different teams make different choices based on their context. A startup with frontend developers and tight timelines might standardize on Amplify. A platform engineering team building internal infrastructure might choose CDK for its flexibility and code reusability. A highly regulated organization might mandate CloudFormation for its explicitness and auditability.

### User Profiles: Who Should Use What?

Let's be concrete about the typical user profiles for each tool.

**Frontend developers and startup teams** benefit most from Amplify CLI. These developers are productivity-focused and want sensible defaults. They don't want to think about CloudFormation syntax or CDK constructs—they want their API and database working so they can build the feature that matters. Amplify CLI's interactive prompts feel intuitive, and the integrated frontend libraries reduce boilerplate in client code.

**Full-stack developers and platform teams** are natural CDK users. These developers understand AWS architecture and want to express infrastructure in code without the verbosity of CloudFormation. They need flexibility—they might be building custom constructs for their organization's standards, or they might be orchestrating multiple AWS services with complex interdependencies. CDK feels like the right tool for this audience.

**Infrastructure specialists and enterprise teams** often prefer CloudFormation, particularly for large-scale deployments. They might use CDK to generate CloudFormation, but they review and manage the generated templates explicitly. They need visibility, auditability, and compliance with governance standards. For these teams, the explicitness of CloudFormation templates is a feature, not a bug.

That said, these are guidelines, not absolutes. A frontend developer might choose CDK if she's building infrastructure-heavy features. An infrastructure specialist might use Amplify CLI for quick prototypes. The tools exist on a spectrum, and developers can use multiple tools for different parts of their system.

### Migration Paths: Moving Between Tools

What if you start with Amplify CLI but your application's needs grow beyond its scope? Or you begin with CDK but realize you want higher-level abstractions for certain components? AWS's layered approach makes migration surprisingly feasible.

**From Amplify to CDK**: Since Amplify generates CDK code, you can inspect the generated code, export it, and refactor it into pure CDK. The `amplify export` command can help with this. You lose the Amplify CLI's interactive workflows, but your infrastructure remains manageable. This migration is relatively smooth because both tools ultimately express infrastructure the same way—as code that synthesizes to CloudFormation.

**From Amplify to CloudFormation**: Less common, but possible. You can view your Amplify-generated CloudFormation templates in the AWS console and export them. If you've heavily customized your Amplify backend with manual CDK code, you'd need to refactor those customizations into pure CloudFormation. This is more labor-intensive but still feasible.

**From CDK to CloudFormation**: Run `cdk synth` to generate the CloudFormation templates, then use those templates directly. You'll lose the abstraction benefits of CDK, but your infrastructure remains the same. This is straightforward from a technical perspective, though it might feel like a step backward in terms of development experience.

**From CloudFormation to CDK**: This is less common but worthwhile if you're consolidating infrastructure code. Some tools can parse CloudFormation and generate CDK code, but the quality varies. More reliably, you can reference existing CloudFormation stacks from CDK using `Stack.fromStackName()`, gradually migrating stack by stack.

**From CDK or CloudFormation to Amplify**: This is the trickiest migration. Amplify assumes it owns and manages your infrastructure. If you have existing infrastructure defined in CDK or CloudFormation, you can't easily import it into an Amplify project. You'd likely need to maintain parallel systems or refactor your infrastructure to match Amplify's model.

The key insight is that migration is generally possible in the downward direction (more abstract to less abstract) but more difficult in the upward direction. Plan accordingly when you choose your starting tool.

### Practical Decision Framework

Let's bring this together into a practical framework for choosing the right tool.

Start by asking: **Who is your primary user?** If it's frontend developers without deep AWS experience, Amplify CLI is probably your best bet. If it's infrastructure engineers, CDK is more suitable. If you have compliance or auditability requirements, CloudFormation might be mandated.

Next ask: **What's the scope of your infrastructure?** Amplify CLI excels at application backends—auth, databases, APIs, hosting. If you're building multi-tier systems with specialized services like Redshift, ElastiCache, or Kubernetes, you'll outgrow Amplify quickly. CloudFormation and CDK support the full AWS service portfolio.

Then consider: **How much customization do you need?** Amplify CLI is fastest when you accept its defaults. As soon as you need significant customization, it becomes friction. CDK supports customization more gracefully. CloudFormation supports arbitrary customization but at the cost of development speed.

Ask yourself: **What's your team's maturity?** Early-stage teams benefit from Amplify's simplicity. Mature teams with infrastructure expertise can leverage CDK's flexibility. Teams with compliance requirements might need CloudFormation's explicitness.

Finally: **How might your needs evolve?** Expect to start simple and grow complex. If you think you'll eventually need infrastructure beyond Amplify's scope, starting with CDK avoids a painful migration later. Conversely, if you're confident you'll stay within Amplify's guardrails, the productivity gains justify starting there.

### Real-World Scenarios

Let's apply this framework to concrete scenarios you might face.

**Scenario 1: Building a SaaS product from scratch**

You're a founder with full-stack JavaScript skills but no deep AWS experience. You need to launch quickly. Amplify CLI is your tool. It gets you an authenticated user system, a serverless API, and a database in minutes. The generated frontend libraries reduce boilerplate. You can focus on building your product rather than infrastructure. When specific requirements emerge (maybe you need custom Cognito attributes), you'll drop into Amplify's CDK layer for targeted customizations.

**Scenario 2: Building infrastructure for a platform team**

You're responsible for infrastructure standards across multiple teams. You need reusable constructs that enforce your organization's patterns—VPC configurations, security groups, monitoring dashboards, and logging standards. CDK is ideal here. You can create custom constructs that hide complexity and enforce consistency. Individual teams use your constructs without deep infrastructure knowledge, while you maintain control over standards and security.

**Scenario 3: Migrating a complex application from on-premises**

Your organization is moving a sophisticated system to AWS. It involves multiple tiers—database, application servers, load balancers, caching, message queues, specialized services. You need fine-grained control over every component for compliance and performance. CloudFormation (possibly generated by CDK) is appropriate. The investment in understanding each resource and its properties is necessary given the system's complexity.

**Scenario 4: Rapid prototyping and experimentation**

You're exploring a new feature or technology and need to spin up infrastructure quickly. Amplify CLI is perfect for this. Its interactive prompts make decisions for you, and `amplify delete` cleanly removes everything when you're done. The low friction encourages experimentation.

### Conclusion

Choosing between Amplify CLI, CDK, and CloudFormation isn't about picking the "best" tool—it's about matching tools to context. These tools exist on a spectrum from high abstraction (Amplify) to low abstraction (CloudFormation), with CDK comfortably in the middle offering both flexibility and productivity.

Amplify CLI is built for developers who want to focus on application logic, not infrastructure concerns. It prioritizes speed and comes with sensible defaults for full-stack applications. CDK is for developers who need flexibility and code reusability without sacrificing readability. CloudFormation is for teams that need maximum control, auditability, and the ability to express any AWS infrastructure pattern.

Understanding how these tools relate—that Amplify generates CDK which generates CloudFormation—demystifies the ecosystem. It also means migration is possible as your needs evolve. You might start with Amplify for rapid development, graduate to CDK as your infrastructure grows, and reference CloudFormation templates when you need ultimate control.

The most important thing is to choose consciously. Think about your team's skills, your project's scope, your organization's requirements, and your expected growth. Then pick the tool that maximizes your productivity while providing the control you need. And remember—these tools are designed to work together, not against each other. Your infrastructure-as-code strategy can evolve as your application and organization do.
