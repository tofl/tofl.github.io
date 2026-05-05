---
title: "CDK Constructs Composition: Building Higher-Order Abstractions from L2 and L3 Blocks"
---

## CDK Constructs Composition: Building Higher-Order Abstractions from L2 and L3 Blocks

When you first start using AWS CDK, you build infrastructure by combining individual L2 and L3 constructs directly in your stack. A simple web application might wire together an API Gateway, a Lambda function, an IAM role, a DynamoDB table, and CloudWatch logging—all described in dozens of lines of code scattered across your stack file. Now imagine building ten similar applications. That's a lot of repetition, and repetition is the enemy of maintainability.

This is where construct composition shines. By bundling related resources into higher-order constructs, you can encapsulate complexity, enforce consistent patterns across your infrastructure, and share reusable building blocks across projects. In this guide, we'll explore how to design and publish composable CDK constructs that solve real problems without sacrificing flexibility.

### Why Compose Constructs?

Before diving into the mechanics, let's establish why construct composition matters. Think of it as the infrastructure-as-code equivalent of writing libraries in traditional software development. Just as you wouldn't rewrite a JSON parser for every project, you shouldn't rebuild the same pattern of interconnected AWS resources repeatedly.

Construct composition serves several purposes. First, it encapsulates domain knowledge. When you build a "serverless data pipeline," you're not just throwing together independent resources—you're capturing architectural decisions, security best practices, and integration patterns that your team has learned over time. Second, it reduces cognitive load. A developer provisioning a data pipeline should focus on business logic, not on wiring IAM policies or configuring log retention. Third, it creates a consistent interface. If every data pipeline in your organization looks and behaves the same way at the code level, onboarding new team members becomes easier, and debugging becomes more straightforward.

Finally, composition enables rapid iteration. When your team discovers a better way to configure something—say, tightening security policies or improving monitoring—you update the construct once, and every project that depends on it benefits automatically (provided you manage versioning thoughtfully).

### Understanding the Abstraction Layers

AWS CDK provides three levels of constructs, and understanding where each fits is crucial for effective composition.

L1 constructs are the lowest level. They're auto-generated from CloudFormation resource specifications and provide a direct, one-to-one mapping to CloudFormation resources. If you need to create an S3 bucket, the L1 construct (`CfnBucket`) exposes every possible CloudFormation property. These are powerful but verbose and require significant boilerplate to use safely.

L2 constructs are where most of your day-to-day work happens. They're hand-written by AWS and provide sensible defaults, intelligent properties, and helper methods. An L2 `Bucket` construct, for example, automatically enables versioning, encryption, and block public access settings by default—protecting you from common misconfiguration. L2 constructs often include methods that handle resource integration details for you, like `bucket.grantRead()` for setting up IAM permissions.

L3 constructs, often called patterns, bundle multiple L2 and L1 constructs into cohesive units representing architectural patterns. The `ApplicationLoadBalancedFargateService` is a classic example—it creates an ALB, security groups, ECS cluster, service, and task definition all configured to work together.

When you compose constructs, you're typically creating new L3 constructs that combine existing L2 and sometimes L3 constructs. You're adding another layer of abstraction, but a meaningful one that reflects your organization's patterns and requirements.

### Designing Composable Constructs

Effective construct composition starts with thoughtful design. Let's walk through the key decisions you need to make.

**Identify the pattern.** Start by observing what resources commonly appear together in your infrastructure. Do you always pair a Lambda function with a specific IAM role structure, a DynamoDB table, and a CloudWatch log group? Does your organization standardize on particular encryption settings, monitoring dashboards, or alarm configurations? Each of these recurring patterns is a candidate for a composed construct.

**Define the interface.** Your construct's interface should expose enough customization to be useful without becoming overwhelming. This means choosing which properties to expose as constructor parameters and which to keep internal. For instance, a ServerlessDataPipeline construct might expose the Lambda function's memory and timeout as parameters, but hide the specific IAM policy document structure. Users shouldn't need to understand internal security decisions to use your construct.

**Decide on composition boundaries.** Ask yourself what belongs inside the construct and what should remain external. Should the construct create its own DynamoDB table, or should it accept a table reference as a parameter? If it creates the table, you've made a choice for users about naming and configuration. If it accepts a reference, you've provided flexibility but shifted responsibility. Neither is always right—it depends on your use case. A construct meant for rapid prototyping might include the table; one meant for enterprise deployments might not.

**Plan for observability.** From the beginning, build in CloudWatch metrics, X-Ray tracing, and alarms. Don't treat observability as an afterthought. A well-designed construct should surface meaningful metrics and logs that help users understand what's happening inside.

### Building a Practical Example: ServerlessDataPipeline

Let's create a concrete example to ground these principles. A ServerlessDataPipeline construct bundles together a Lambda function that reads from an event source, writes to a DynamoDB table, and publishes metrics to CloudWatch. It handles IAM permissions, logging, dead-letter queues, and monitoring out of the box.

Here's the basic structure:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface ServerlessDataPipelineProps {
  /**
   * The code for the Lambda function handler.
   */
  handler: lambda.IFunction;

  /**
   * Memory allocated to the Lambda function (in MB).
   * @default 512
   */
  lambdaMemory?: number;

  /**
   * Timeout for the Lambda function (in seconds).
   * @default 60
   */
  lambdaTimeout?: number;

  /**
   * Billing mode for the DynamoDB table.
   * @default PAY_PER_REQUEST
   */
  tableMode?: dynamodb.BillingMode;

  /**
   * Environment variables to pass to the Lambda function.
   * @default {}
   */
  environment?: { [key: string]: string };

  /**
   * CloudWatch log retention period (in days).
   * @default 7
   */
  logRetentionDays?: number;

  /**
   * Enable X-Ray tracing.
   * @default true
   */
  tracingEnabled?: boolean;
}

export class ServerlessDataPipeline extends Construct {
  public readonly handler: lambda.Function;
  public readonly table: dynamodb.Table;
  public readonly logGroup: logs.LogGroup;

  constructor(
    scope: Construct,
    id: string,
    props: ServerlessDataPipelineProps,
  ) {
    super(scope, id);

    // Create DynamoDB table with sensible defaults
    this.table = new dynamodb.Table(this, 'DataTable', {
      partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
      billingMode: props.tableMode ?? dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // Create CloudWatch log group with retention
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      retention: logs.RetentionDays[`_${props.logRetentionDays ?? 7}`],
      encryptionKey: undefined, // Could be customized
    });

    // Create the Lambda function
    this.handler = new lambda.Function(this, 'Handler', {
      code: props.handler.code,
      handler: props.handler.handler,
      runtime: props.handler.runtime,
      memory: props.lambdaMemory ?? 512,
      timeout: cdk.Duration.seconds(props.lambdaTimeout ?? 60),
      logGroup: this.logGroup,
      environment: {
        TABLE_NAME: this.table.tableName,
        ...props.environment,
      },
      tracing: props.tracingEnabled ?? true
        ? lambda.Tracing.ACTIVE
        : lambda.Tracing.DISABLED,
    });

    // Grant the Lambda function permission to read/write the table
    this.table.grantReadWriteData(this.handler);

    // Add custom CloudWatch alarms for monitoring
    new cdk.aws_cloudwatch.Alarm(this, 'ErrorAlarm', {
      metric: this.handler.metricErrors(),
      threshold: 1,
      evaluationPeriods: 1,
      alarmDescription: 'Alert when Lambda errors occur',
    });
  }

  /**
   * Grant another construct permission to read from the pipeline's table.
   */
  public grantRead(grantable: iam.IGrantable): iam.Grant {
    return this.table.grantReadData(grantable);
  }

  /**
   * Grant another construct permission to write to the pipeline's table.
   */
  public grantWrite(grantable: iam.IGrantable): iam.Grant {
    return this.table.grantWriteData(grantable);
  }
}
```

This construct abstracts away the boilerplate. A user can now create a complete, production-ready data pipeline with just a few lines:

```typescript
const pipeline = new ServerlessDataPipeline(stack, 'MyPipeline', {
  handler: myLambdaFunction,
  lambdaMemory: 256,
  lambdaTimeout: 120,
  environment: { CUSTOM_VAR: 'value' },
});
```

The construct internally handles IAM permissions, logging, encryption, and monitoring. Users can still access the underlying resources (`pipeline.table`, `pipeline.handler`, `pipeline.logGroup`) if they need to customize further, but most won't.

### Exposing Configuration Properties Thoughtfully

The properties interface is your construct's contract with the outside world. Design it carefully.

Start with required parameters only when truly necessary. Most parameters should be optional with sensible defaults. The defaults should represent the most common use case or the most secure/recommended configuration. For example, in our ServerlessDataPipeline, we default to PAY_PER_REQUEST billing for DynamoDB because it's appropriate for unpredictable workloads, and we default to X-Ray tracing because observability is important.

Use JSDoc comments to document every property. Explain what it does, why someone might want to change it, and what the default is. This documentation becomes invaluable when developers use your construct months later and can't remember what each property does.

Consider grouping related properties. If your construct supports multiple configuration "flavors"—like development versus production settings—you might accept a preset string that sets multiple properties at once:

```typescript
export type EnvironmentType = 'development' | 'production';

export interface ServerlessDataPipelineProps {
  // ... other props
  environment?: EnvironmentType;
  // When 'development', uses smaller memory, shorter retention
  // When 'production', uses larger memory, longer retention, backup enabled
}
```

Avoid exposing implementation details. Don't ask users to specify IAM policy documents, for example. Instead, expose high-level permissions like `allowReadFromExternalTable()` methods. The construct should handle the policy document internally.

### Handling Construct Dependencies and Relationships

Real-world constructs often need to interact with resources created outside the construct. A ServerlessDataPipeline might need to write to an external bucket, or a user might want to add a second DynamoDB table for caching.

Handle this by accepting interface parameters. Rather than requiring a specific L2 `Bucket` object, ask for `s3.IBucket`—the interface. This gives users flexibility to provide newly created buckets, existing buckets, or even mock implementations for testing:

```typescript
export interface ServerlessDataPipelineProps {
  // ... other props
  outputBucket?: s3.IBucket;
  externalTables?: { [key: string]: dynamodb.ITable };
}

constructor(scope: Construct, id: string, props: ServerlessDataPipelineProps) {
  // ... earlier code ...

  if (props.outputBucket) {
    props.outputBucket.grantWrite(this.handler);
    this.handler.addEnvironment('OUTPUT_BUCKET', props.outputBucket.bucketName);
  }

  if (props.externalTables) {
    Object.entries(props.externalTables).forEach(([name, table]) => {
      table.grantReadData(this.handler);
      this.handler.addEnvironment(`${name}_TABLE`, table.tableName);
    });
  }
}
```

This approach maintains flexibility without tightly coupling your construct to other constructs.

### Construct Versioning and Breaking Changes

Once you publish a construct, other projects depend on it. Changing the interface carelessly breaks downstream code.

Use semantic versioning: MAJOR.MINOR.PATCH. Increment MAJOR when making breaking changes (removing a property, changing a parameter type), MINOR when adding new functionality backward-compatibly, and PATCH for bug fixes. Most constructs start at version 1.0.0.

When you need to make a breaking change, deprecate the old interface first. Mark properties as deprecated using JSDoc:

```typescript
export interface ServerlessDataPipelineProps {
  /**
   * @deprecated Use `tableMode` instead.
   */
  useDynamoDBPay?: boolean;

  tableMode?: dynamodb.BillingMode;
}
```

Document the deprecation in your changelog. In the next major version, remove the deprecated property entirely.

For non-breaking enhancements, just add new optional properties. Existing code continues to work, and new code can use the new features.

Consider providing a migration guide when you release a breaking version. Show users exactly what code changes they need to make.

### Publishing to npm

Once your construct is tested and documented, publish it to npm so other projects can depend on it. This transforms it from organizational code to a shared asset.

Start by creating a package.json file in your construct directory:

```json
{
  "name": "@your-org/serverless-data-pipeline",
  "version": "1.0.0",
  "description": "A composable CDK construct for serverless data pipelines",
  "main": "lib/index.js",
  "types": "lib/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "jest",
    "lint": "eslint src/**/*.ts"
  },
  "dependencies": {
    "aws-cdk-lib": "^2.50.0",
    "constructs": "^10.0.0"
  },
  "devDependencies": {
    "@types/node": "^18.0.0",
    "typescript": "^4.9.0"
  },
  "peerDependencies": {
    "aws-cdk-lib": "^2.0.0",
    "constructs": "^10.0.0"
  }
}
```

Note that aws-cdk-lib and constructs are peer dependencies. This prevents version conflicts if a project uses multiple constructs.

Write a comprehensive README that explains what the construct does, shows a basic example, documents all properties, and provides troubleshooting guidance. A good README is your first line of documentation.

Before publishing, create a test suite:

```typescript
import { Template } from 'aws-cdk-lib/assertions';
import * as cdk from 'aws-cdk-lib';
import { ServerlessDataPipeline } from '../lib';

describe('ServerlessDataPipeline', () => {
  it('creates a Lambda function with DynamoDB table', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'TestStack');

    const pipeline = new ServerlessDataPipeline(stack, 'Pipeline', {
      handler: new cdk.aws_lambda.Function(stack, 'TestHandler', {
        code: cdk.aws_lambda.Code.fromAsset('fixtures/lambda'),
        handler: 'index.handler',
        runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
      }),
    });

    const template = Template.fromStack(stack);
    template.hasResourceProperties('AWS::Lambda::Function', {});
    template.hasResourceProperties('AWS::DynamoDB::Table', {});
  });
});
```

The CDK assertions library makes it easy to verify that your construct creates the expected CloudFormation resources with the correct properties.

Once tested, build the TypeScript to JavaScript and publish:

```bash
npm run build
npm publish
```

If publishing to a private registry or scoped packages (recommended for organizational constructs), configure your npm settings accordingly.

### Best Practices for Maintainability

As your construct gains users, maintainability becomes critical. A few practices help immensely.

Keep constructs focused. A construct should represent a single architectural pattern. If you're tempted to bundle together unrelated concerns—say, combining a data pipeline with a web API—consider whether they should be separate constructs that users can compose together.

Write clear, abundant documentation. Include examples of common use cases, explain design decisions in comments, and document any assumptions the construct makes about the environment.

Invest in testing. Test the happy path, but also test edge cases and invalid inputs. Use CDK assertions to verify CloudFormation output. Write integration tests if possible.

Monitor for issues in production. If users report problems, respond quickly. Construct libraries are only as good as their reliability.

Keep dependencies minimal. Every dependency you take on becomes a transitive dependency for all your users. If you can solve a problem with only aws-cdk-lib, prefer that over pulling in another package.

### Composing Constructs Together

The real power of composition emerges when you compose higher-order constructs into even higher-order constructs. Build a `ServerlessAnalyticsStack` that bundles together multiple `ServerlessDataPipeline` instances, adds cross-pipeline monitoring, and exposes a unified interface.

This multi-level composition allows you to build increasingly sophisticated abstractions without overwhelming complexity at any single level. Each construct layer handles its own concerns and exposes clean interfaces to the layer above.

### Conclusion

Construct composition transforms CDK from a resource-provisioning tool into a true infrastructure-as-code framework where you capture your organization's patterns and best practices in reusable, maintainable code. By thoughtfully combining L2 and L3 constructs into higher-order abstractions, you reduce boilerplate, enforce consistency, and make infrastructure code as approachable as application code.

Start by identifying patterns in your existing infrastructure. Build a construct that encapsulates one of those patterns, with a carefully designed interface that balances flexibility with usability. Test it thoroughly, document it clearly, and share it with your team. As you refine it based on real-world usage and publish it to npm, you're not just writing code—you're codifying organizational knowledge and making every future project easier to build.
