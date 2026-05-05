---
title: "Migrating from CloudFormation to CDK: Step-by-Step Conversion Guide"
---

## Migrating from CloudFormation to CDK: Step-by-Step Conversion Guide

### Introduction

You've built infrastructure on AWS CloudFormation. Your templates work. They're in version control. They scale. But as your team grows and complexity increases, you're eyeing the AWS Cloud Development Kit (CDK) with a mixture of curiosity and anxiety. The promise is compelling: write infrastructure as real code, leverage your programming language's type system, compose reusable components, and reduce boilerplate. Yet the question looms: how do you actually get there from where you are?

The good news is that migrating from CloudFormation to CDK doesn't require a big-bang rewrite. You can adopt CDK incrementally, even within the same project. This guide walks you through practical strategies for converting your CloudFormation templates to CDK, whether you're starting small or tackling enterprise-scale infrastructure.

### Understanding the CDK Construct Hierarchy

Before diving into conversion tactics, it's worth understanding how CDK is organized. CDK constructs come in three levels, each building on the one below.

**L1 constructs** (also called Cfn constructs) are thin wrappers around CloudFormation resources. They map one-to-one with CloudFormation resource types. Working with L1 constructs is roughly equivalent to writing CloudFormation in TypeScript or Python—you still have to think about every property and relationship. A CloudFormation `AWS::EC2::SecurityGroup` becomes a `CfnSecurityGroup` in CDK. These constructs are auto-generated directly from the CloudFormation specification, so they're always complete and up-to-date with AWS's latest resource types and properties.

**L2 constructs** are AWS's curated, developer-friendly abstractions. They encapsulate best practices, sensible defaults, and cleaner APIs. Instead of manually configuring security groups, network ACLs, and routes for a VPC, you use the `Vpc` construct, which handles that complexity behind the scenes. L2 constructs are hand-written and opinionated—they express how AWS architects think you should build things.

**L3 constructs** (patterns) are domain-specific solutions for common application patterns. Think of them as prescriptive templates that combine multiple AWS services into a coherent whole. An example might be a construct that sets up a fully functional load-balanced ECS cluster with auto-scaling, CloudWatch dashboards, and application logging all pre-configured.

The migration path naturally flows from L1 (direct CloudFormation replacement) to L2 (idiomatic CDK) to L3 (where appropriate). Understanding this hierarchy will shape your conversion strategy.

### Assessing Your CloudFormation Templates

Before you write a single line of CDK code, take stock of what you're migrating. Not all templates are equal, and some patterns migrate more smoothly than others.

Start by identifying the scope and complexity of your templates. A single-template stack with 10–20 resources is straightforward to convert. A multi-template setup with nested stacks, cross-stack references, and conditional logic requires more planning. Look at your parameter usage—do you have many parameters that allow flexible deployments? CDK handles this through context values and configuration, which we'll cover later.

Check for custom resources and Lambda functions embedded in your templates. These often translate well to CDK, though you may want to refactor them into separate files. Review any dependencies between stacks: if Stack A outputs values that Stack B imports via `Fn::ImportValue`, you'll need to understand that relationship and replicate it in CDK using stack references.

Also audit your use of CloudFormation intrinsic functions like `Ref`, `Fn::Join`, `Fn::Sub`, and `Fn::GetAZs`. Heavy reliance on these functions sometimes indicates opportunities to simplify the design, not just translate syntax.

### Converting with the cfn2ts Tool

AWS provides an automated conversion tool called `cfn2ts` that can give you a quick head start. It's available as an npm package and attempts to transform your CloudFormation templates directly into CDK code.

To use it, install the tool globally:

```bash
npm install -g @amazon-web-services-cloudformation/cloudformation-cli-typescript-lib
```

Then point it at your template:

```bash
cfn2ts path/to/your-template.json > stack.ts
```

The tool will generate a CDK stack class with L1 constructs matching your CloudFormation resources. This is genuinely useful—it saves you from manually typing out every resource property and ensures you don't accidentally omit anything.

**However, important caveats apply.** The generated code is almost never production-ready. It's a starting point, not a destination. The generated code will likely have unused imports, suboptimal structure, and missed opportunities to leverage L2 constructs. Additionally, the tool sometimes struggles with complex intrinsic function logic or unusual property combinations. It's best thought of as a translation aid that handles the mechanical work, freeing you to focus on design and optimization.

In practice, many teams find it faster to manually migrate moderately sized templates (say, under 50 resources) using the strategy outlined in the next section, rather than spend time fixing auto-generated code.

### Manual Migration: From CloudFormation to L1 Constructs

If you're converting by hand, the mechanical approach is to replace each CloudFormation resource with its L1 construct equivalent. This is a straightforward, line-by-line translation that should take less time than you might expect.

Let's walk through a concrete example. Suppose you have a CloudFormation template defining a VPC and EC2 instance:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Simple VPC with an EC2 instance'
Parameters:
  InstanceType:
    Type: String
    Default: t3.micro
Resources:
  MyVpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.0.0.0/16
      EnableDnsHostnames: true
      EnableDnsSupport: true
  MySubnet:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref MyVpc
      CidrBlock: 10.0.1.0/24
      AvailabilityZone: us-east-1a
  MySecurityGroup:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: Allow SSH and HTTP
      VpcId: !Ref MyVpc
      SecurityGroupIngress:
        - IpProtocol: tcp
          FromPort: 22
          ToPort: 22
          CidrIp: 0.0.0.0/0
        - IpProtocol: tcp
          FromPort: 80
          ToPort: 80
          CidrIp: 0.0.0.0/0
  MyInstance:
    Type: AWS::EC2::Instance
    Properties:
      ImageId: ami-0c55b159cbfafe1f0
      InstanceType: !Ref InstanceType
      SubnetId: !Ref MySubnet
      SecurityGroupIds:
        - !Ref MySecurityGroup
Outputs:
  InstancePublicIp:
    Value: !GetAtt MyInstance.PublicIp
    Export:
      Name: MyInstancePublicIp
```

Here's how you'd convert this to CDK using L1 constructs:

```typescript
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';

interface MyStackProps extends cdk.StackProps {
  instanceType?: string;
}

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: MyStackProps) {
    super(scope, id, props);

    const instanceType = props?.instanceType ?? 't3.micro';

    const vpc = new ec2.CfnVPC(this, 'MyVpc', {
      cidrBlock: '10.0.0.0/16',
      enableDnsHostnames: true,
      enableDnsSupport: true,
    });

    const subnet = new ec2.CfnSubnet(this, 'MySubnet', {
      vpcId: vpc.ref,
      cidrBlock: '10.0.1.0/24',
      availabilityZone: 'us-east-1a',
    });

    const securityGroup = new ec2.CfnSecurityGroup(this, 'MySecurityGroup', {
      groupDescription: 'Allow SSH and HTTP',
      vpcId: vpc.ref,
      securityGroupIngress: [
        {
          ipProtocol: 'tcp',
          fromPort: 22,
          toPort: 22,
          cidrIp: '0.0.0.0/0',
        },
        {
          ipProtocol: 'tcp',
          fromPort: 80,
          toPort: 80,
          cidrIp: '0.0.0.0/0',
        },
      ],
    });

    const instance = new ec2.CfnInstance(this, 'MyInstance', {
      imageId: 'ami-0c55b159cbfafe1f0',
      instanceType: instanceType,
      subnetId: subnet.ref,
      securityGroupIds: [securityGroup.ref],
    });

    new cdk.CfnOutput(this, 'InstancePublicIp', {
      value: instance.attrPublicIp,
      exportName: 'MyInstancePublicIp',
    });
  }
}
```

Notice the pattern here:

- CloudFormation resources become Cfn* constructs (e.g., `CfnVPC`, `CfnSecurityGroup`).
- Resource references using `!Ref` become `.ref` properties in CDK.
- Attributes accessed via `!GetAtt` become methods like `.attrPublicIp`.
- Properties map directly, with camelCase converted to camelCase (they're already there).
- Parameters become constructor options that you pass to the stack.
- Outputs become `CfnOutput` constructs.

This translation is mechanical and relatively safe—you're not changing logic, just syntax. At this point, your stack works, and if you deploy it, CDK will generate the same CloudFormation under the hood.

### Refactoring to L2 Constructs

Once you have a working L1 translation, the real power of CDK emerges when you refactor toward L2 constructs. This step is optional but highly recommended because it dramatically reduces boilerplate and bakes in best practices.

Let's refactor the previous example:

```typescript
import * as cdk from 'aws-cdk-lib';
import { aws_ec2 as ec2 } from 'aws-cdk-lib';

interface MyStackProps extends cdk.StackProps {
  instanceType?: string;
}

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: MyStackProps) {
    super(scope, id, props);

    const instanceType = props?.instanceType ?? 't3.micro';

    // Use L2 Vpc construct—it handles subnets, availability zones, NAT gateways, etc.
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      cidrMask: 24,
      maxAzs: 1,
    });

    // Use L2 SecurityGroup construct—cleaner API
    const securityGroup = new ec2.SecurityGroup(this, 'MySecurityGroup', {
      vpc,
      description: 'Allow SSH and HTTP',
      allowAllOutbound: true,
    });

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allow SSH'
    );
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP'
    );

    // Use L2 Instance construct
    const instance = new ec2.Instance(this, 'MyInstance', {
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux2(),
      securityGroup,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    new cdk.CfnOutput(this, 'InstancePublicIp', {
      value: instance.instancePublicIp,
      exportName: 'MyInstancePublicIp',
    });
  }
}
```

See the improvements:

- The `Vpc` construct automatically creates subnets across multiple availability zones (configurable), handles DNS settings, and applies sensible defaults.
- The `SecurityGroup` and `Instance` constructs use a fluent, object-oriented API that's more intuitive.
- You no longer manually manage references—just pass the VPC to constructs that need it.
- Properties like `machineImage` can use factory methods like `latestAmazonLinux2()` instead of hardcoded AMI IDs, making your code more portable.
- The instance type is expressed using strongly-typed enums (`InstanceClass.T3`, `InstanceSize.MICRO`) rather than strings.

The refactored code is shorter, clearer, and less error-prone. More importantly, it captures intent. Someone reading this code immediately understands you're creating a simple web server, not wading through property configurations.

### Handling Context Values and Parameters

CloudFormation parameters translate to CDK context values. Context values are key-value pairs that let you parameterize your infrastructure without modifying code.

In CloudFormation, you might use parameters like this:

```yaml
Parameters:
  Environment:
    Type: String
    Default: dev
    AllowedValues:
      - dev
      - staging
      - prod
  VpcCidr:
    Type: String
    Default: 10.0.0.0/16
```

In CDK, you'd access these through the node's context:

```typescript
const environment = this.node.tryGetContext('environment') ?? 'dev';
const vpcCidr = this.node.tryGetContext('vpcCidr') ?? '10.0.0.0/16';
```

You can supply context values in several ways:

Pass them directly on the command line when deploying:

```bash
cdk deploy -c environment=prod -c vpcCidr=10.1.0.0/16
```

Define them in a `cdk.context.json` file in your project root:

```json
{
  "environment": "prod",
  "vpcCidr": "10.1.0.0/16"
}
```

Or hardcode them in your stack initialization within `bin/` files:

```typescript
const app = new cdk.App();
new MyStack(app, 'MyStack', {
  environment: 'prod',
  vpcCidr: '10.1.0.0/16',
});
```

The context approach is more flexible than CloudFormation parameters because you can use the same stack definition across environments by simply varying context values. It's also easier to validate and transform context values using your programming language's full power, rather than CloudFormation's limited parameter validation.

### Importing Existing CloudFormation Stacks

One of CDK's great strengths is the ability to work alongside existing CloudFormation stacks. You don't have to migrate everything at once. You can selectively import existing resources or entire stacks into CDK.

#### Importing Individual Resources

If you have an existing CloudFormation stack and want to reference one of its outputs in CDK, use `Fn.importValue()`:

```typescript
const existingBucketName = cdk.Fn.importValue('MyExistingBucketName');

const bucket = s3.Bucket.fromBucketName(
  this,
  'ImportedBucket',
  existingBucketName
);
```

This works when your CloudFormation template exports a value using the `Export` property in an output.

#### Importing Entire Stacks

For a more comprehensive approach, you can import a physical resource ID from an existing stack. For example, if a CloudFormation stack created a VPC and you want to reference it in a new CDK stack:

```typescript
const existingVpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
  vpcId: 'vpc-12345678',
});
```

Or, to look up by tag:

```typescript
const existingVpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
  tags: {
    Name: 'my-existing-vpc',
  },
});
```

These approaches let you gradually migrate infrastructure. Your CDK stack can depend on existing CloudFormation stacks, and you move resources incrementally over time.

### Managing Stack Migrations in Practice

Real-world migrations rarely happen overnight. Here's a pragmatic approach:

**Phase 1: Proof of concept.** Convert a small, non-critical CloudFormation template using L1 constructs. Deploy it to a development environment. Verify the generated CloudFormation matches your expectations. This phase answers the question: does our team understand CDK well enough to use it?

**Phase 2: Selective refactoring.** Take that proof of concept and refactor high-value sections to L2 constructs. Focus on areas where L2 constructs exist and offer clear benefits. Leave lower-value sections in L1 if it saves time and complexity. The goal is to build confidence and establish patterns your team can follow.

**Phase 3: Parallel stacks.** For critical infrastructure, run both the old CloudFormation stack and a new CDK-generated version in parallel for a period. This de-risks the migration. You can validate that the CDK version behaves identically, then switch over and deprecate the old one.

**Phase 4: Full migration.** Once your team is comfortable, migrate remaining templates. Organize CDK code into reusable stacks and constructs. Establish conventions for naming, structure, and testing.

### Working with Nested Stacks and Constructs

CloudFormation nested stacks are a way to organize and reuse template components. In CDK, the equivalent (and more powerful) mechanism is composing constructs.

A CloudFormation nested stack might look like:

```yaml
Resources:
  VpcStack:
    Type: AWS::CloudFormation::Stack
    Properties:
      TemplateURL: https://my-bucket.s3.amazonaws.com/vpc-template.json
      Parameters:
        CidrBlock: 10.0.0.0/16
```

In CDK, you'd define a reusable construct:

```typescript
interface VpcStackProps extends cdk.StackProps {
  cidrBlock: string;
}

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: cdk.App, id: string, props: VpcStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      cidrMask: 24,
      maxAzs: 2,
    });
  }
}
```

Then, in your main stack, you instantiate it:

```typescript
const vpcStack = new VpcStack(app, 'VpcStack', {
  cidrBlock: '10.0.0.0/16',
});

const appStack = new cdk.Stack(app, 'AppStack');
const vpc = vpcStack.vpc;
// Use the VPC...
```

Alternatively, you can create a reusable construct (not a stack):

```typescript
interface VpcProps {
  cidrBlock: string;
}

export class MyVpc extends Construct {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: VpcProps) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      cidrMask: 24,
      maxAzs: 2,
    });
  }
}
```

And use it within a stack:

```typescript
export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const myVpc = new MyVpc(this, 'MyVpc', {
      cidrBlock: '10.0.0.0/16',
    });
  }
}
```

CDK constructs are more composable and powerful than nested stacks. They integrate seamlessly with the construct tree, support dependency ordering automatically, and let you export properties for reuse in ways nested stacks can't easily match.

### Testing Your Migrated Infrastructure

One major benefit of CDK is that it's code, and code can be tested. CloudFormation templates are notoriously hard to validate without deploying them. CDK offers several testing approaches.

The simplest is a template snapshot test using the CDK assertions library:

```typescript
import { Template } from 'aws-cdk-lib/assertions';

test('VPC Stack creates expected resources', () => {
  const app = new cdk.App();
  const stack = new MyStack(app, 'TestStack');

  const template = Template.fromStack(stack);

  // Verify that the template contains a VPC
  template.hasResourceProperties('AWS::EC2::VPC', {
    CidrBlock: '10.0.0.0/16',
  });

  // Verify security group ingress rule
  template.hasResourceProperties('AWS::EC2::SecurityGroupIngress', {
    FromPort: 22,
    ToPort: 22,
  });
});
```

You can also count resources:

```typescript
template.resourceCountIs('AWS::EC2::Instance', 1);
```

Or verify outputs:

```typescript
template.hasOutput('InstancePublicIp', {
  exportName: 'MyInstancePublicIp',
});
```

These tests run instantly without touching AWS, giving you confidence that your stack definition is correct before deployment. As you migrate, adding tests validates that your CDK code generates the same CloudFormation as your original templates.

### Common Migration Gotchas

Watch out for these issues when migrating:

**AMI IDs.** Hardcoded AMI IDs from CloudFormation templates are often outdated. Use CDK's `MachineImage.latestAmazonLinux2()` or similar factory methods instead. This keeps your infrastructure evergreen.

**Default values and best practices.** L2 constructs apply defaults that may differ subtly from your original templates. For example, a `Vpc` construct creates NAT gateways by default, but your original template might not have. Review the generated CloudFormation after your first deployment to spot differences. If they're undesirable, you can customize them via constructor properties.

**Intrinsic functions.** Complex `Fn::Sub` or `Fn::GetAZs` logic can be tricky to replicate idiomatically in CDK. Sometimes it's worth rethinking the design. For instance, instead of manually querying availability zones, use CDK's built-in support for multi-AZ deployments.

**Cross-account and cross-region references.** If your CloudFormation uses cross-account stack references, CDK still supports this, but you need to be explicit about it. Use `Fn.importValue()` for cross-stack references or manually pass references when instantiating stacks.

**Stateful resources and data.** If your CloudFormation template creates databases, S3 buckets, or other data-bearing resources, be extremely careful when migrating. A simple re-deploy of a CDK stack might delete these resources if deletion policies aren't configured correctly. Always set explicit deletion policies on stateful resources.

### Structuring CDK Projects for Maintainability

As your CDK project grows, structure matters. A common organization looks like this:

```
my-cdk-project/
├── bin/
│   └── app.ts              # Entry point; instantiates stacks
├── lib/
│   ├── stacks/
│   │   ├── vpc-stack.ts
│   │   ├── app-stack.ts
│   │   └── database-stack.ts
│   └── constructs/
│       ├── my-vpc.ts
│       ├── my-alb.ts
│       └── my-database.ts
├── test/
│   ├── stacks.test.ts
│   └── constructs.test.ts
├── cdk.json
├── tsconfig.json
├── package.json
└── README.md
```

The `bin/` directory contains your app entry point. The `lib/` directory holds stacks and custom constructs. Test files mirror the structure of the code they test. This organization keeps dependencies clear and makes it easy for new team members to navigate.

Within constructs, follow a convention where you export public properties that other parts of your infrastructure need to reference:

```typescript
export class MyVpc extends Construct {
  public readonly vpc: ec2.Vpc;
  public readonly publicSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string) {
    super(scope, id);
    this.vpc = new ec2.Vpc(this, 'Vpc', { /* ... */ });
    this.publicSubnets = this.vpc.publicSubnets;
  }
}
```

This makes it explicit what other stacks and constructs can depend on.

### Deployment and Rollback Strategies

CDK deployments use CloudFormation under the hood, so the same update and rollback semantics apply. However, CDK adds a synthesis step where TypeScript is compiled to CloudFormation JSON.

When you run `cdk deploy`, CDK:

1. Synthesizes your code into a CloudFormation template (usually written to `cdk.out/`).
2. Compares the template to the currently deployed stack.
3. Shows you a diff of changes.
4. Asks for confirmation before proceeding.
5. Executes the CloudFormation update.

This process is safer than raw `aws cloudformation` commands because you see what's changing before it happens. For production deployments, many teams integrate this into CI/CD pipelines where the diff is reviewed and approved before deployment proceeds.

If something goes wrong, you have the same rollback options as CloudFormation: automatic rollback on error, or manual rollback to a previous stack state using the AWS console.

### Conclusion

Migrating from CloudFormation to CDK is not an all-or-nothing proposition. You can start with automated conversion tools to establish a baseline, refactor incrementally toward L2 constructs as your team gains confidence, and run new and old infrastructure in parallel during a transition period. The investment pays dividends through clearer code, better composability, type safety, and reduced boilerplate.

Begin with a small, non-critical template. Get comfortable with L1 constructs first—they're a safe, direct translation. Then explore L2 constructs and discover where they simplify your code. Build reusable components in the `lib/` directory. Write tests to validate your templates without deploying. Structure your project for maintainability.

CloudFormation and CDK coexist peacefully. You're not abandoning everything you've built; you're building on it with a more powerful toolset. The result is infrastructure code that's easier to understand, test, and maintain—and that's worth the effort of migration.
