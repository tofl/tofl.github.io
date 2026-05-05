---
title: "CDK Assertions and Testing: Unit Testing Infrastructure Code"
---

# CDK Assertions and Testing: Unit Testing Infrastructure Code

If you've ever deployed infrastructure code only to discover a resource is misconfigured, a security group is too permissive, or an IAM role lacks a critical permission, you've experienced the pain of infrastructure bugs making their way to production. Infrastructure as Code promises reproducibility and safety—but only if you test it before deployment. That's where AWS CDK Assertions comes in. It's a testing library that lets you validate your infrastructure code locally, without spinning up actual AWS resources, catching configuration errors and security issues before they ever reach your environment.

Whether you're building a microservices platform or managing a multi-account organization, the ability to unit test your infrastructure code is transformational. It shifts left on quality, catches bugs early, accelerates development feedback loops, and gives you confidence that your stack definitions will produce exactly what you intend. In this article, we'll explore how to use CDK Assertions to write comprehensive tests for your AWS CDK constructs and stacks, complete with practical examples and patterns you can apply immediately.

### Understanding CDK Assertions in Context

When you write infrastructure code with AWS CDK, you're ultimately generating CloudFormation templates. CDK Assertions is a testing library that inspects the CloudFormation template your CDK code produces and validates that it contains the resources and configurations you expect.

Think of it this way: your CDK code is a generator, CloudFormation is the specification it produces, and CDK Assertions is your validator. You never need to deploy anything. You simply synthesize your stack into a CloudFormation template and then write assertions against that template to verify its structure and properties match your intentions.

This approach offers several compelling advantages. First, tests run in milliseconds rather than minutes, since no AWS resources are created. Second, you can run tests locally during development without ever touching AWS credentials. Third, you catch bugs at the point where they're easiest to fix—in your source code. Finally, you can write tests that verify security properties like IAM policies, encryption settings, and network configurations, ensuring your infrastructure follows best practices and compliance requirements by design.

### Setting Up Your Testing Environment

Before you write your first assertion, you need to have the right dependencies in place. If you've scaffolded a CDK project using the CDK CLI, you likely already have the testing library installed, but let's make sure.

For a TypeScript project, install the assertions library alongside your existing CDK dependencies:

```bash
npm install --save-dev @aws-cdk/assertions
```

If you're working in Python, the equivalent is:

```bash
pip install aws-cdk-lib[assertions]
```

You'll also want a test runner. TypeScript projects typically use Jest, while Python projects often use pytest. Let's assume Jest for TypeScript and pytest for Python in our examples, though the patterns work with other frameworks too.

Once installed, you're ready to start writing tests. The typical structure is straightforward: you synthesize your stack, extract the CloudFormation template, and then use assertion helpers to validate its contents.

### Synthesizing Your Stack and Extracting the Template

Before writing assertions, you need to capture the CloudFormation template your CDK stack produces. The Template class from the assertions library does exactly this.

Here's a simple example in TypeScript. Imagine you have a basic stack that creates an S3 bucket:

```typescript
import { Stack } from 'aws-cdk-lib';
import { Bucket } from 'aws-cdk-lib/aws-s3';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    new Bucket(this, 'MyBucket', {
      versioned: true,
      blockPublicAccess: { blockPublicAcls: true, blockPublicPolicy: true },
    });
  }
}
```

In your test file, you'd set up the template like this:

```typescript
import { Template } from 'aws-cdk-lib/assertions';
import { Stack } from 'aws-cdk-lib';

describe('MyStack', () => {
  it('should create an S3 bucket with versioning enabled', () => {
    const stack = new MyStack(new Stack(), 'TestStack');
    const template = Template.fromStack(stack);
    
    // Assertions will go here
  });
});
```

The `Template.fromStack()` method synthesizes your stack and gives you an object you can run assertions against. This is your entry point to everything that follows.

### Testing for Resource Existence

The most basic assertion is verifying that a resource of a certain type exists. Use the `hasResourceProperties` method to check that a specific resource with particular properties is present in the template.

Continuing our S3 bucket example:

```typescript
it('should create an S3 bucket', () => {
  const stack = new MyStack(new Stack(), 'TestStack');
  const template = Template.fromStack(stack);
  
  template.hasResourceProperties('AWS::S3::Bucket', {
    VersioningConfiguration: {
      Status: 'Enabled',
    },
  });
});
```

This assertion verifies two things: first, that at least one CloudFormation resource of type `AWS::S3::Bucket` exists in the template, and second, that it has the specified `VersioningConfiguration`. If either condition fails, the test fails.

You can also count resources to ensure you have exactly the number you expect:

```typescript
it('should create exactly one S3 bucket', () => {
  const stack = new MyStack(new Stack(), 'TestStack');
  const template = Template.fromStack(stack);
  
  template.resourceCountIs('AWS::S3::Bucket', 1);
});
```

This is useful when you want to ensure you haven't accidentally created duplicate resources due to a loop or conditional logic bug.

### Validating Specific Resource Properties

Beyond simple existence checks, you'll often need to validate that specific resource properties are set correctly. This is where CDK Assertions becomes powerful for catching security and configuration issues.

Let's expand our S3 bucket test. Suppose your organization requires that all S3 buckets have encryption enabled and be private by default. You can write assertions for these:

```typescript
it('should enforce encryption and block public access on S3 bucket', () => {
  const stack = new MyStack(new Stack(), 'TestStack');
  const template = Template.fromStack(stack);
  
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: {
      ServerSideEncryptionConfiguration: [
        {
          ServerSideEncryptionByDefault: {
            SSEAlgorithm: 'AES256',
          },
        },
      ],
    },
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
  });
});
```

When you pass a properties object to `hasResourceProperties`, the assertion uses pattern matching. It doesn't require an exact match—it just validates that the resource contains at least the properties you've specified. This is intentional, since CDK might add additional properties or default values you don't care about testing.

### Using Matchers for Flexible Assertions

Sometimes you want to verify that a property exists but don't care about its exact value, or you want to use conditional logic in your assertions. The Match object provides several matchers for these scenarios.

For example, suppose an IAM role gets assigned an ARN, and you want to verify the ARN is present without caring about the exact account ID:

```typescript
import { Match } from 'aws-cdk-lib/assertions';

it('should create an IAM role with appropriate ARN format', () => {
  const stack = new MyStack(new Stack(), 'TestStack');
  const template = Template.fromStack(stack);
  
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: 'Allow',
          Principal: {
            Service: 'lambda.amazonaws.com',
          },
        }),
      ]),
    }),
  });
});
```

The `Match.objectLike()` matcher performs a partial match on an object, checking that it contains the properties you've specified without requiring an exact match. The `Match.arrayWith()` matcher checks that an array contains at least the elements you've specified. These matchers are invaluable for writing assertions that are specific enough to catch bugs but flexible enough to tolerate harmless variations in the generated template.

Other useful matchers include `Match.stringLike()` for partial string matching (useful for ARNs), `Match.exact()` for strict equality, and `Match.anything()` for asserting that a property exists without validating its value.

### Testing IAM Policies and Permissions

One of the most powerful uses of CDK Assertions is validating IAM policies. Security misconfigurations often slip through because they don't cause runtime errors—they just silently grant the wrong permissions. Assertions catch these at test time.

Suppose you have a Lambda function that needs to read from an S3 bucket and write logs to CloudWatch. Your CDK stack grants the necessary permissions, and you want to verify they're exactly right:

```typescript
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';

export class LambdaStack extends Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    
    const bucket = new Bucket(this, 'SourceBucket');
    
    const lambda = new Function(this, 'MyFunction', {
      runtime: Runtime.NODEJS_18_X,
      code: Code.fromAsset('src'),
      handler: 'index.handler',
    });
    
    lambda.addToRolePolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ['s3:GetObject'],
      resources: [bucket.arnForObjects('*')],
    }));
  }
}
```

Now, in your test, you can verify the policy is exactly as intended:

```typescript
import { Match } from 'aws-cdk-lib/assertions';

it('should grant Lambda permission to read S3 objects', () => {
  const stack = new LambdaStack(new Stack(), 'TestStack');
  const template = Template.fromStack(stack);
  
  template.hasResourceProperties('AWS::IAM::Role', {
    AssumeRolePolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
        }),
      ]),
    }),
  });
  
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: Match.objectLike({
      Statement: Match.arrayWith([
        Match.objectLike({
          Effect: 'Allow',
          Action: 's3:GetObject',
          Resource: Match.stringLike(`arn:aws:s3:::*/*`),
        }),
      ]),
    }),
  });
});
```

This test verifies not just that an IAM policy exists, but that it grants exactly the `s3:GetObject` action on S3 object ARNs. If someone accidentally expanded the policy to include `s3:*` or added an unintended principal, the test would catch it.

### Testing Construct Composition and Dependencies

Complex infrastructure often involves multiple constructs working together. CDK Assertions helps you verify that these compositions work as expected. For instance, you might want to ensure that when you create a web tier construct, it properly creates both a security group and an auto-scaling group with the right configurations.

Here's an example. Suppose you have a WebTier construct that encapsulates an Auto Scaling Group behind a load balancer:

```typescript
export class WebTier extends Construct {
  public readonly asg: AutoScalingGroup;
  public readonly alb: ApplicationLoadBalancer;
  
  constructor(scope: Construct, id: string) {
    super(scope, id);
    
    const vpc = new Vpc(this, 'VPC', { maxAzs: 2 });
    
    this.asg = new AutoScalingGroup(this, 'ASG', {
      vpc,
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MEDIUM),
      machineImage: new AmazonLinuxImage(),
      desiredCapacity: 3,
      minCapacity: 1,
      maxCapacity: 5,
    });
    
    this.alb = new ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
    });
  }
}
```

Your test might verify the basic structure:

```typescript
it('should create WebTier with ASG and ALB', () => {
  const stack = new Stack();
  new WebTier(stack, 'WebTier');
  const template = Template.fromStack(stack);
  
  template.resourceCountIs('AWS::AutoScaling::AutoScalingGroup', 1);
  template.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  
  template.hasResourceProperties('AWS::AutoScaling::AutoScalingGroup', {
    MinSize: '1',
    MaxSize: '5',
    DesiredCapacity: '3',
  });
});
```

You can also verify the relationships between resources by checking that security groups, target groups, or other references are set up correctly. When you inspect the generated template, you'll see that CDK has resolved all the cross-resource references into CloudFormation intrinsic functions (like `Ref` and `GetAtt`), and you can assert on those relationships.

### Testing Conditional Logic and Parameters

Real-world stacks often have conditional logic—you might create different resources based on environment or configuration. CDK Assertions makes it easy to verify that your conditionals work as intended.

Suppose you have a stack that uses a context value to decide whether to enable encryption:

```typescript
export class FlexibleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    
    const enableEncryption = this.node.tryGetContext('enableEncryption') ?? false;
    
    const bucket = new Bucket(this, 'DataBucket', {
      encryption: enableEncryption ? BucketEncryption.S3_MANAGED : BucketEncryption.UNENCRYPTED,
    });
  }
}
```

You can test both branches of this logic:

```typescript
it('should create encrypted bucket when enableEncryption is true', () => {
  const app = new App({ context: { enableEncryption: true } });
  const stack = new FlexibleStack(app, 'TestStack');
  const template = Template.fromStack(stack);
  
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: Match.objectLike({
      ServerSideEncryptionConfiguration: Match.arrayWith([Match.anything()]),
    }),
  });
});

it('should create unencrypted bucket when enableEncryption is false', () => {
  const app = new App({ context: { enableEncryption: false } });
  const stack = new FlexibleStack(app, 'TestStack');
  const template = Template.fromStack(stack);
  
  template.hasResourceProperties('AWS::S3::Bucket', {
    BucketEncryption: Match.absent(),
  });
});
```

The `Match.absent()` matcher is essential here—it verifies that a property does not exist in the resource. This is how you confirm that your conditional logic produces genuinely different templates.

### Advanced Assertion Patterns

As your infrastructure grows more complex, you'll benefit from more sophisticated assertion patterns. Let me share a few that I've found particularly useful in real projects.

**Testing for missing properties** can sometimes be as important as testing for their presence. Use `Match.absent()` to verify that a resource doesn't have a property that shouldn't be there. This is critical for security—for example, ensuring that a database isn't publicly accessible:

```typescript
it('should not make RDS database publicly accessible', () => {
  const stack = new MyStack(new Stack(), 'TestStack');
  const template = Template.fromStack(stack);
  
  template.hasResourceProperties('AWS::RDS::DBInstance', {
    PubliclyAccessible: Match.absent(),
  });
});
```

**Testing with snapshots** is another powerful pattern for catching unexpected changes. Jest's snapshot feature integrates seamlessly with CDK Assertions. You can serialize the entire template and verify it against a baseline:

```typescript
it('should match the infrastructure snapshot', () => {
  const stack = new MyStack(new Stack(), 'TestStack');
  const template = Template.fromStack(stack);
  
  expect(template.toJSON()).toMatchSnapshot();
});
```

This catches any unintended changes to your template structure, even ones that might not break functionality but represent deviations from your design.

**Testing multiple stacks together** helps verify that your application architecture components integrate correctly. You might have separate stacks for networking, databases, and compute, and you want to ensure they work together properly:

```typescript
it('should create correct cross-stack references', () => {
  const networkStack = new NetworkStack(app, 'Network');
  const appStack = new ApplicationStack(app, 'Application', {
    vpc: networkStack.vpc,
  });
  
  const appTemplate = Template.fromStack(appStack);
  appTemplate.hasResourceProperties('AWS::EC2::SecurityGroup', {
    VpcId: Match.stringLike(`arn:aws:ec2:*`),
  });
});
```

### Writing Reusable Test Helpers

As you write more tests, you'll notice patterns repeating. Rather than duplicating assertion code, create helper functions that encapsulate common validation logic. This improves readability and maintainability.

For example, if you frequently test that resources follow your organization's security standards, create a helper:

```typescript
function assertBucketIsSecure(template: Template) {
  template.hasResourceProperties('AWS::S3::Bucket', {
    PublicAccessBlockConfiguration: {
      BlockPublicAcls: true,
      BlockPublicPolicy: true,
      IgnorePublicAcls: true,
      RestrictPublicBuckets: true,
    },
    BucketEncryption: Match.objectLike({
      ServerSideEncryptionConfiguration: Match.arrayWith([
        Match.objectLike({
          ServerSideEncryptionByDefault: Match.objectLike({
            SSEAlgorithm: 'aws:kms',
          }),
        }),
      ]),
    }),
    LoggingConfiguration: Match.objectLike({
      DestinationBucketName: Match.stringLike('*'),
    }),
  });
}

it('should create a secure S3 bucket', () => {
  const stack = new MyStack(new Stack(), 'TestStack');
  const template = Template.fromStack(stack);
  
  assertBucketIsSecure(template);
});
```

This approach makes your tests more declarative and easier to maintain as your security requirements evolve.

### Integrating Tests Into Your CI/CD Pipeline

CDK Assertions truly shines when integrated into a continuous integration pipeline. Your tests should run automatically on every commit, catching misconfigurations before they reach any environment.

A typical workflow looks like this: a developer commits changes to their CDK stack, the CI pipeline checks out the code, installs dependencies, runs `npm test` or `pytest`, and reports pass/fail before the code is merged. If tests fail, the developer fixes the infrastructure code and pushes again. Only code with passing tests gets deployed.

This is dramatically safer than the alternative—deploying infrastructure and discovering problems in staging or production. It also provides confidence that your infrastructure matches your design and security requirements.

In a multi-account setup, you might have different tests for different deployment targets. For instance, production stacks might have stricter requirements for encryption, logging, and IAM policies than development stacks:

```typescript
describe('Production Configuration', () => {
  it('should enforce encryption on all resources', () => {
    const app = new App({ context: { environment: 'production' } });
    const stack = new MyStack(app, 'ProdStack');
    const template = Template.fromStack(stack);
    
    // Strict encryption requirements
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.objectLike({
        ServerSideEncryptionConfiguration: Match.arrayWith([
          Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'aws:kms' } }),
        ]),
      }),
    });
  });
});

describe('Development Configuration', () => {
  it('should allow simpler encryption in dev', () => {
    const app = new App({ context: { environment: 'development' } });
    const stack = new MyStack(app, 'DevStack');
    const template = Template.fromStack(stack);
    
    // Less strict requirements for faster development
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketEncryption: Match.anything(),
    });
  });
});
```

This pattern ensures that your infrastructure code is evaluated against the right standards for each environment.

### Common Testing Pitfalls to Avoid

While CDK Assertions is straightforward, there are a few stumbling blocks worth knowing about.

First, remember that assertion libraries use CloudFormation's view of resources. Some CDK-level convenience features might not map directly to CloudFormation properties. When an assertion fails, look at the actual CloudFormation template being generated. You can print it with `console.log(template.toJSON())` to debug. Understanding what your CDK code actually generates is invaluable.

Second, be careful with resource naming and IDs. When you create multiple resources of the same type, CDK generates unique logical IDs for each. If you expect a specific number of resources but your code creates more due to a hidden dependency, tests will fail. Use `resourceCountIs` to catch these issues.

Third, don't over-test. Assertions are powerful, but if you assert on every single property, your tests become brittle and hard to maintain. Focus on the properties that matter—security settings, critical configurations, resource counts, and architectural relationships. Let minor defaults and non-critical properties vary.

Finally, keep your test data small and focused. Create minimal stacks in test cases that exercise exactly one concern. This makes tests fast, easy to understand, and robust against unrelated changes.

### Conclusion

CDK Assertions transforms infrastructure code from something you cross your fingers about when deploying into something you can systematically validate and test. By writing unit tests for your stacks before deployment, you shift quality left, catch bugs early, and build confidence in your infrastructure automation.

The patterns we've explored—testing for resource existence, validating specific properties, checking IAM policies, testing conditionals, and integrating tests into CI/CD pipelines—form a comprehensive testing strategy for any CDK project. Start with simple assertions that verify your stack produces the resources you expect, then layer on more sophisticated checks for security, configuration, and architectural relationships.

As your infrastructure grows and evolves, your tests become documentation of intent. They specify exactly what your stacks should produce and catch regressions quickly. Combined with CDK's type safety and the AWS CDK construct library's high-level abstractions, testing with CDK Assertions puts you on the path toward mature, reliable infrastructure automation practices.
