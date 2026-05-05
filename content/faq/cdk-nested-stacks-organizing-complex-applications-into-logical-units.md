---
title: "CDK Nested Stacks: Organizing Complex Applications into Logical Units"
---

## CDK Nested Stacks: Organizing Complex Applications into Logical Units

Building cloud infrastructure as code with AWS CDK is powerful, but as your application grows, a single monolithic stack can become unwieldy. You end up with hundreds of resources defined in one place, making it harder to reason about dependencies, test individual components, and reuse patterns across projects. This is where nested stacks come in. They let you decompose a large CDK application into smaller, logically organized stacks that work together as a cohesive unit. In this article, we'll explore what nested stacks are, why they matter, how to use them effectively, and the trade-offs you need to understand.

### Understanding Nested Stacks and Why They Matter

A nested stack is a CloudFormation stack that is created and managed as a resource within a parent stack. In CDK terms, you use the `NestedStack` construct to define a child stack, instantiate it within a parent stack, and the CDK synthesizes everything into CloudFormation templates that handle the nesting for you.

The core motivation is straightforward: organization and manageability. Imagine you're building a multi-tier application with networking resources, databases, compute resources, and application services. Putting all of this into a single stack definition makes your code hard to navigate and understand. By splitting these concerns into separate nested stacks, you create a clearer mental model of your infrastructure. Each nested stack can focus on a specific domain—say, networking or data layer—and can be tested and reasoned about independently.

Beyond organization, nested stacks improve reusability. If you've built a well-designed networking stack, you might want to use it across multiple applications without copying and pasting code. A nested stack can be imported and instantiated just like any other construct, making pattern sharing across your organization much more practical.

### How Nested Stacks Work Under the Hood

When you synthesize a CDK application that uses nested stacks, the CDK generates multiple CloudFormation templates. The parent stack gets its own template, and each nested stack gets its own template. The parent template contains a special `AWS::CloudFormation::Stack` resource that references the nested stack's template, typically by uploading it to an S3 bucket that CDK manages on your behalf.

Here's what actually happens when you deploy:

First, CloudFormation creates the parent stack. As it processes resources, it encounters the `AWS::CloudFormation::Stack` resource definitions for each nested stack. CloudFormation then creates those nested stacks in sequence, passing any parameters you've defined. The nested stacks can output values, which the parent stack can reference and pass to other resources. From CloudFormation's perspective, the nested stacks are just like any other resource in the parent stack, except they happen to be stacks themselves.

This approach has a major implication: nested stacks have their own lifecycle. You can delete a nested stack independently (through the parent or directly), and the parent remains intact. However, if you delete the parent stack, all nested stacks are deleted as well. This hierarchical relationship is central to understanding how nested stacks behave.

### Setting Up a Nested Stack: A Practical Example

Let's build a concrete example to see how this works in practice. Imagine a three-tier application with separate concerns: networking, database, and compute. We'll create nested stacks for each.

First, here's a simple networking nested stack:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface NetworkingStackProps extends cdk.NestedStackProps {
  cidrBlock: string;
}

export class NetworkingStack extends cdk.NestedStack {
  public readonly vpc: ec2.Vpc;
  public readonly publicSubnets: ec2.ISubnet[];

  constructor(scope: Construct, id: string, props: NetworkingStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'VPC', {
      cidr: props.cidrBlock,
      maxAzs: 2,
      natGateways: 1,
    });

    this.publicSubnets = this.vpc.publicSubnets;
  }
}
```

Notice that `NetworkingStack` extends `cdk.NestedStack` rather than `cdk.Stack`. It accepts `NestedStackProps`, which includes all the standard stack properties. We're also exporting the VPC and subnets so the parent stack can access them.

Next, let's define a database nested stack:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface DatabaseStackProps extends cdk.NestedStackProps {
  vpc: ec2.IVpc;
  databaseName: string;
}

export class DatabaseStack extends cdk.NestedStack {
  public readonly database: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    this.database = new rds.DatabaseInstance(this, 'Database', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO
      ),
      vpc: props.vpc,
      allocatedStorage: 20,
      databaseName: props.databaseName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
```

The database stack receives the VPC from its properties, creating a dependency on the networking stack. This demonstrates how nested stacks communicate: the parent passes resources or values to children via props.

Now, here's the parent stack that ties everything together:

```typescript
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NetworkingStack } from './networking-stack';
import { DatabaseStack } from './database-stack';

export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create the networking nested stack
    const networking = new NetworkingStack(this, 'Networking', {
      cidrBlock: '10.0.0.0/16',
    });

    // Create the database nested stack, passing the VPC
    const database = new DatabaseStack(this, 'Database', {
      vpc: networking.vpc,
      databaseName: 'myapp',
    });

    // You could add compute resources here that reference both
    // networking.vpc and database.database
  }
}
```

When you synthesize and deploy this stack, CDK creates the parent template and templates for both nested stacks. The parent CloudFormation stack manages the creation of the two nested stacks in the correct order, respecting dependencies.

### Passing Parameters Between Parent and Child Stacks

Communication between parent and child stacks happens through properties and exports. The pattern we just saw—passing resources through props—works well when the child needs to reference something from the parent. But sometimes you'll want to make your nested stacks more reusable and loosely coupled.

CloudFormation supports stack outputs and cross-stack references. In CDK, when you access a property of a nested stack that originated from a resource it created, CDK automatically generates the necessary CloudFormation outputs and references behind the scenes. This is handled transparently in most cases.

However, if you want explicit control, you can use the `addOutput` method on a nested stack. This is useful when you want to make specific values available to the parent stack or for inspection:

```typescript
export class NetworkingStack extends cdk.NestedStack {
  public readonly vpcId: string;

  constructor(scope: Construct, id: string, props: NetworkingStackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'VPC', {
      cidr: props.cidrBlock,
      maxAzs: 2,
    });

    this.vpcId = this.vpc.vpcId;

    // Explicitly export the VPC ID for clarity
    new cdk.CfnOutput(this, 'VpcIdOutput', {
      value: this.vpc.vpcId,
      exportName: `${this.stackName}-VpcId`,
    });
  }
}
```

The parent stack can then reference this output. In most cases, though, simply storing resources as properties on your nested stack class and accessing them from the parent is the most idiomatic CDK approach.

### Limitations and Trade-offs of Nested Stacks

While nested stacks offer organizational benefits, they come with constraints you should understand before deciding to use them.

**Template Size Limits**: CloudFormation has a hard limit of 51,200 bytes for template size. Nested stacks help circumvent this because each nested stack gets its own template. However, the parent template itself can still hit limits if it references many nested stacks or has complex resource declarations. If you're hitting template size issues, nested stacks are a valuable solution, but be aware that the total size of all templates combined is still large and CloudFormation must process each one.

**Eventual Consistency and Rollback Behavior**: CloudFormation creates nested stacks sequentially based on dependencies. If a nested stack fails to create, the parent stack creation fails and rolls back. Conversely, if the parent stack fails after some nested stacks have been created, the nested stacks may remain in place, leading to orphaned resources. Understanding this behavior is crucial for production deployments. You need to think carefully about your rollback strategy and consider whether to use the `RemovalPolicy.RETAIN` option for critical resources.

**Cross-Stack References**: While you can pass resources between stacks through properties, CloudFormation cross-stack references (using the `Fn::ImportValue` function) have their own limitations. They can't be updated without updating both stacks, and they create tight coupling. CDK generally handles this for you, but if you explicitly use exports and imports, you're accepting those constraints.

**Increased Complexity for Simpler Projects**: Not every application needs nested stacks. If your infrastructure fits comfortably in a single stack—say, under 100 resources and well-organized—the added complexity of nested stacks may not be worth it. Nested stacks shine when you have large, multi-domain applications or when you need to reuse patterns across many projects.

**Regional Limitations**: Nested stacks must be in the same AWS region as the parent stack. You can't use a nested stack in one region and reference it from another. If you're building multi-region applications, nested stacks won't help you share resources across regions.

### Designing Nested Stacks for Reusability

If you're building nested stacks to reuse across projects, think about the contract each stack exports. A well-designed nested stack should have clear inputs (properties) and outputs (exported resources or values). It should be self-contained in terms of what it owns and manages.

For instance, a reusable networking stack should accept a few key parameters (CIDR blocks, availability zones, NAT gateway settings) and export a VPC and subnets. It shouldn't depend on application-specific concerns. Similarly, a reusable database stack should know how to provision a database but not make assumptions about the application using it.

You can also create a library of nested stacks within your organization. Rather than defining them inline in an application, package them as a separate CDK construct library. This makes them discoverable and allows multiple teams to benefit from shared patterns.

### When to Use Nested Stacks vs. Other Approaches

CDK offers several ways to organize code. Understanding when to use nested stacks versus alternatives is important.

**Nested Stacks vs. Constructs**: Constructs are the fundamental building block of CDK. They're composable units that encapsulate resources and logic. Most of the time, you should use constructs to organize your code. Nested stacks are heavier—they result in separate CloudFormation stacks with their own lifecycle. Use nested stacks when you need that separate lifecycle, when you're hitting template size limits, or when you want to ship reusable stacks as deployable units.

**Nested Stacks vs. Multiple Top-Level Stacks**: You could also just deploy multiple independent stacks that reference each other. This gives you maximum flexibility but requires manual coordination of dependencies and outputs. Nested stacks automate this dependency management through CloudFormation, so the parent stack ensures nested stacks are created in the right order. If your stacks are truly independent and managed by different teams, multiple top-level stacks might be the right choice. If they're components of a single application, nested stacks are cleaner.

**Nested Stacks vs. Stack Sets**: AWS CloudFormation StackSets are designed for deploying the same stack across multiple AWS accounts and regions. This is different from nested stacks, which are about organizing a single stack hierarchically. Don't confuse the two.

### Best Practices for Nested Stack Design

Keep these principles in mind as you design nested stacks:

Define clear boundaries. Each nested stack should own a specific domain—networking, databases, compute, or application services. Avoid creating nested stacks that span multiple concerns or have dependencies across many nested stacks.

Document your stack interface. Make it clear what inputs a nested stack expects and what it exports. Use TypeScript types to enforce this contract and make your code self-documenting.

Test nested stacks independently. Before integrating a nested stack into a parent, deploy it on its own to verify it works. This catches errors early and makes it easier to troubleshoot issues.

Use consistent naming conventions. When you have multiple nested stacks, consistent naming makes it easier to find resources in the AWS console and correlate them with your code.

Consider your naming strategy for resources across stacks. By default, CDK constructs within nested stacks are scoped to that stack, but physical resource names might collide if you're not careful. Use unique identifiers or environment-specific prefixes if you're deploying multiple instances of the same nested stacks.

Monitor stack events and outputs. Nested stacks generate CloudFormation events just like regular stacks. When troubleshooting, check the AWS CloudFormation console to see events from all stacks in the hierarchy.

### A Complete Multi-Tier Example

Let's extend our earlier example with a compute layer to show a more complete picture:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';

interface ComputeStackProps extends cdk.NestedStackProps {
  vpc: ec2.IVpc;
  databaseHost: string;
}

export class ComputeStack extends cdk.NestedStack {
  public readonly securityGroup: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    this.securityGroup = new ec2.SecurityGroup(this, 'AppSecurityGroup', {
      vpc: props.vpc,
      description: 'Security group for application servers',
    });

    // Allow inbound HTTP/HTTPS from anywhere
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP'
    );
    this.securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS'
    );

    // In a real application, you'd create EC2 instances, ECS clusters, or Lambda functions here
    // For now, we're just setting up the security group
  }
}
```

And the updated parent stack:

```typescript
export class ApplicationStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const networking = new NetworkingStack(this, 'Networking', {
      cidrBlock: '10.0.0.0/16',
    });

    const database = new DatabaseStack(this, 'Database', {
      vpc: networking.vpc,
      databaseName: 'myapp',
    });

    const compute = new ComputeStack(this, 'Compute', {
      vpc: networking.vpc,
      databaseHost: database.database.dbInstanceEndpointAddress,
    });

    // Allow compute layer to reach database
    database.database.connections.allowDefaultPortFrom(compute.securityGroup);
  }
}
```

This structure clearly separates concerns. The networking stack creates the VPC, the database stack creates the RDS instance in that VPC, and the compute stack creates compute resources and security groups. The parent stack orchestrates them and establishes the security group rules for communication between layers.

### Conclusion

Nested stacks are a powerful tool for organizing complex CDK applications into logically coherent, reusable units. By breaking a monolithic stack into smaller, domain-focused nested stacks, you gain clarity in your infrastructure code, improve testability, and create patterns that can be shared across projects.

However, nested stacks aren't a universal solution. They introduce additional CloudFormation templates and operational complexity. For smaller applications, a single well-organized stack with good constructs is often sufficient. The key is understanding the trade-offs: nested stacks excel at managing large, multi-domain applications, respecting template size limits, and enabling pattern reuse across your organization, but they require careful attention to dependencies, rollback behavior, and lifecycle management.

As you grow your AWS infrastructure with CDK, think about your application's architecture. Are there natural boundaries between components? Would separating them into nested stacks improve your code organization? Will you want to reuse patterns across multiple projects? If the answers are yes, nested stacks are worth investigating. Start with a simple example, deploy it, and observe how CloudFormation templates are generated and stacks are created. Once you understand the mechanics, you'll be well-equipped to decide when nested stacks are the right tool for your infrastructure challenges.
