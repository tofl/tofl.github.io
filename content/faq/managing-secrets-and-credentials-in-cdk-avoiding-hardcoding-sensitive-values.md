---
title: "Managing Secrets and Credentials in CDK: Avoiding Hardcoding Sensitive Values"
---

## Managing Secrets and Credentials in CDK: Avoiding Hardcoding Sensitive Values

Every developer has been tempted—or done it themselves—to paste a database password directly into code, just to get things moving. It works, until it doesn't. When that hardcoded secret makes its way into a Git commit, a build artifact, or a deployed container image, you're no longer managing credentials; they're managing you. AWS CDK makes it straightforward to handle secrets securely, but the patterns aren't always obvious. This article walks you through the right way to manage sensitive values in CDK applications, showing you how to retrieve secrets from AWS services and inject them into your infrastructure without ever touching raw credentials in your code.

### Why Hardcoding Secrets Is Not Just Bad Practice—It's a Security Liability

Before we talk about solutions, let's be honest about the problem. When you hardcode a database password, API key, or SSH private key directly into your CDK TypeScript file or even into your `cdk.json` configuration file, you're creating a ticking time bomb. Here's what happens in practice:

Your source code—including any hardcoded secrets—lives in a Git repository. Even if you delete the secret later, it remains in the repository's history. Any developer with access to the repo (or anyone who forks it publicly) can recover that secret. If your repository is ever compromised, an attacker has immediate access to your databases, third-party services, or internal systems.

Beyond Git, secrets in code get baked into build artifacts, Docker images, and deployment logs. They appear in CloudFormation templates, which AWS stores and makes accessible to anyone with sufficient IAM permissions. They clutter application logs when things go wrong. The attack surface explodes, and the blast radius is impossible to contain once a secret is exposed.

The right approach is fundamentally different: secrets should never exist in code or configuration files. Instead, you retrieve them at runtime from a secure, purpose-built service. AWS provides exactly that with Secrets Manager and Systems Manager Parameter Store. CDK integrates seamlessly with both, giving you patterns to fetch secrets during synthesis or deployment and pass them to your constructs without ever storing them in code.

### Secrets Manager vs. Parameter Store: Which One to Use

AWS offers two primary services for storing and retrieving secrets, and understanding the difference helps you choose the right tool for your use case.

**AWS Secrets Manager** is purpose-built for managing sensitive credentials. It supports automatic rotation of secrets on a schedule you define—a Lambda function updates your database password, API key, or other credential without any manual intervention. Secrets are encrypted at rest using KMS, and you can grant fine-grained access via IAM policies. Secrets Manager also integrates with certain AWS services (like RDS) to enable truly automatic rotation where AWS manages the credential update on your behalf. It's the premium option: you pay per stored secret, per API call, and rotation can incur additional costs, but you get robust lifecycle management and audit trails.

**AWS Systems Manager Parameter Store** (part of AWS Systems Manager) stores configuration data and encrypted secrets in a unified interface. It's cheaper than Secrets Manager—you pay per parameter, with a free tier for standard parameters—and it's perfectly adequate for application configuration and less frequently rotated secrets. Parameter Store doesn't offer automatic rotation out of the box, though you can build your own rotation mechanism using Lambda. If you need to rotate credentials frequently or integrate rotation directly with managed services, Secrets Manager is the better choice. For stable configuration and secrets that change infrequently, Parameter Store is simpler and more cost-effective.

For this article, we'll focus on Secrets Manager since it's the recommended approach for production credentials that require rotation. The CDK patterns are similar for both services.

### The Dangers of Configuration Files

You might think that moving a secret from code into `cdk.json` solves the problem. It doesn't. Configuration files are part of your source tree and follow the same Git history forever. They're also easy to accidentally include in build artifacts or commit to the wrong branch. Worse, `cdk.json` is plain text—there's no encryption, no access control, no audit trail. Anyone with filesystem access to your deployment machine can read the file.

The safe approach treats configuration files as for *non-sensitive* values only: environment names, instance sizes, feature flags, ARN patterns. Anything genuinely secret—a database password, an API key, a private certificate—should never appear in any configuration file.

### Retrieving Secrets at CDK Synthesis Time

CDK synthesis happens when you run `cdk synth` or `cdk deploy`. At that moment, your CDK code executes, instantiates constructs, and generates a CloudFormation template. You can fetch secrets from Secrets Manager during synthesis using the AWS SDK.

Here's the pattern: use the `aws-sdk` (or `@aws-sdk/client-secrets-manager` in the v3 SDK) to call Secrets Manager, parse the returned JSON, and pass the secret value as a property to your CDK construct. The secret itself never appears in the synthesized CloudFormation template or in any artifact.

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Note: this is synchronous pseudocode for illustration
    // In real code, you'll need to handle async/await
    const secretsClient = new SecretsManager({ region: 'us-east-1' });
    const secret = await secretsClient.getSecretValue({ SecretId: 'prod/db/password' });
    const dbPassword = JSON.parse(secret.SecretString || '').password;

    const lambdaFunction = new lambda.Function(this, 'MyFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        DB_PASSWORD: dbPassword,
      },
    });
  }
}
```

This approach works, but there's a critical constraint: CDK synthesis must run in an environment that has IAM credentials and network access to Secrets Manager. If you're synthesizing in a restricted CI/CD environment without AWS API access, this pattern breaks. Moreover, if the secret rotates after synthesis but before deployment, your Lambda function receives the old password.

For these reasons, synthesizing with secrets is useful for non-sensitive configuration or for one-off testing environments. For production workloads, the next pattern is more robust.

### Retrieving Secrets at Runtime: The Recommended Approach

Instead of fetching secrets during CDK synthesis, retrieve them at runtime from within your application code. This means your CDK code passes the *secret name* (not the secret value) to your Lambda function or EC2 instance, and the application code fetches and uses the secret when it runs.

This approach has major advantages. The secret rotates independently of CDK deployments. Your application can refresh the credential without redeploying the infrastructure. The credential never appears in CloudFormation, build artifacts, or CDK outputs. And your CI/CD pipeline doesn't need direct access to Secrets Manager—only the running application does.

Here's how you do it in CDK:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Reference an existing secret in Secrets Manager
    const dbSecret = secretsmanager.Secret.fromSecretAttributes(this, 'DbSecret', {
      secretCompleteArn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db/password-ABC123',
    });

    const lambdaFunction = new lambda.Function(this, 'MyFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        SECRET_ARN: dbSecret.secretArn,
      },
    });

    // Grant the Lambda function permission to read the secret
    dbSecret.grantRead(lambdaFunction);
  }
}
```

Notice what happens here: you reference the secret by its ARN (which you know ahead of time) and pass the ARN to your Lambda function via an environment variable. You then use `grantRead` to add an IAM policy that allows the Lambda function to call `GetSecretValue` on that specific secret. The secret value itself never appears in the CDK code or the CloudFormation template.

Inside your Lambda function, you retrieve the secret at runtime:

```typescript
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManager({ region: 'us-east-1' });

export const handler = async (event) => {
  const secretArn = process.env.SECRET_ARN;
  const secret = await secretsClient.getSecretValue({ SecretId: secretArn });
  const credentials = JSON.parse(secret.SecretString || '');
  
  // Use credentials to connect to your database, API, etc.
  console.log('Username:', credentials.username);
  
  return { statusCode: 200, body: 'Success' };
};
```

This pattern is clean, secure, and production-ready. The secret rotates independently, your code fetches it on demand (or with caching), and the infrastructure code never touches sensitive values.

### Integrating with RDS: Automatic Credential Management

If you're using Amazon RDS, Secrets Manager offers a tighter integration. You can create a secret that's automatically managed by AWS, which rotates your database password on a schedule and updates the database itself. CDK makes this integration straightforward.

```typescript
import * as cdk from 'aws-cdk-lib';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc');

    const database = new rds.DatabaseInstance(this, 'MyDatabase', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0 }),
      credentials: rds.Credentials.fromGeneratedSecret('admin'),
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MICRO),
      allocatedStorage: 20,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
```

By passing `rds.Credentials.fromGeneratedSecret()`, you tell CDK to create a secret in Secrets Manager and use it as the database credentials. AWS automatically manages the password, rotates it on a schedule, and updates RDS. Your application code retrieves the credentials from Secrets Manager exactly as shown in the previous section. RDS and Secrets Manager stay synchronized with no manual intervention.

### Rotating Secrets Without Redeploying CDK

One of the most powerful aspects of separating credential management from infrastructure code is that secrets can rotate independently. You don't need to redeploy your CDK stack every time a password changes.

In Secrets Manager, you define a rotation rule: daily, weekly, monthly, or on demand. When rotation happens, a Lambda function (that you configure, or that AWS provides for managed services like RDS) updates the credential in both Secrets Manager and the target system. Your running application fetches the updated secret on its next call to `GetSecretValue`.

If your application caches the secret in memory, you should implement a refresh strategy. A simple approach is to cache the secret for a fixed period (e.g., one hour) and re-fetch it after the cache expires. A more sophisticated approach watches for rotation events via EventBridge and proactively refreshes the cache.

```typescript
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const secretsClient = new SecretsManager({ region: 'us-east-1' });
let cachedSecret = null;
let cacheExpiry = null;

export const handler = async (event) => {
  const secretArn = process.env.SECRET_ARN;
  const now = Date.now();

  // Refresh cache if expired (every 60 minutes)
  if (!cachedSecret || cacheExpiry < now) {
    const secret = await secretsClient.getSecretValue({ SecretId: secretArn });
    cachedSecret = JSON.parse(secret.SecretString || '');
    cacheExpiry = now + 60 * 60 * 1000; // 60 minutes
  }

  // Use cachedSecret for database connections, API calls, etc.
  return cachedSecret;
};
```

This simple cache strategy balances performance (you're not calling Secrets Manager on every request) with safety (secrets refresh frequently enough that rotations are picked up quickly).

### Building a Custom Resource Pattern: Lambda with Database Secret

Now let's tie everything together with a concrete, realistic example: a Lambda function that connects to a PostgreSQL database using a password stored in Secrets Manager and managed by CDK.

First, create the CDK stack:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class DatabaseStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc');

    // Create the RDS database with auto-managed credentials
    const database = new rds.DatabaseInstance(this, 'PostgresDB', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14,
      }),
      credentials: rds.Credentials.fromGeneratedSecret('postgres'),
      vpc,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE3,
        ec2.InstanceSize.MICRO
      ),
      allocatedStorage: 20,
      databaseName: 'myapp',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // The secret is automatically created by RDS
    const dbSecret = database.secret!;

    // Create a Lambda function that will query the database
    const queryFunction = new lambda.Function(this, 'DatabaseQueryFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        SECRET_ARN: dbSecret.secretArn,
        DB_HOST: database.dbInstanceEndpointAddress,
        DB_NAME: 'myapp',
      },
      vpc, // Place Lambda in the same VPC as the database
    });

    // Grant the Lambda function permission to read the secret
    dbSecret.grantRead(queryFunction);

    // Grant the Lambda function network access to the database
    database.connections.allowDefaultPortFrom(queryFunction);
  }
}
```

And here's the Lambda function code that uses the secret:

```typescript
import { SecretsManager } from '@aws-sdk/client-secrets-manager';
import * as pg from 'pg';

const secretsClient = new SecretsManager({ region: 'us-east-1' });

export const handler = async (event) => {
  try {
    // Fetch the secret
    const secretArn = process.env.SECRET_ARN;
    const secret = await secretsClient.getSecretValue({ SecretId: secretArn });
    const credentials = JSON.parse(secret.SecretString || '');

    // Connect to the database using credentials from the secret
    const client = new pg.Client({
      host: process.env.DB_HOST,
      port: 5432,
      database: process.env.DB_NAME,
      user: credentials.username,
      password: credentials.password,
    });

    await client.connect();

    // Execute a simple query
    const result = await client.query('SELECT NOW()');
    console.log('Database time:', result.rows[0]);

    await client.end();

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Query successful', time: result.rows[0].now }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Query failed', error: error.message }),
    };
  }
};
```

When you deploy this stack with `cdk deploy`, several things happen automatically:

CDK creates an RDS instance and a Secrets Manager secret for the database credentials. The secret is encrypted and stored securely in Secrets Manager. CDK creates a Lambda function in the same VPC as the database and passes the secret ARN as an environment variable. CDK adds IAM permissions allowing the Lambda function to call `GetSecretValue` on the secret. CDK configures security group rules so the Lambda function can reach the database.

The deployed Lambda function can now retrieve the database password from Secrets Manager at runtime and connect to the database. If AWS rotates the RDS password according to the rotation schedule, your Lambda function automatically gets the updated credential on the next invocation.

### Handling Secrets in Different Environments

In multi-environment deployments (dev, staging, production), you often have different secrets for each environment. Here's a clean pattern using CDK context:

```typescript
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class MyStack extends cdk.Stack {
  constructor(scope: cdk.App, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Get the environment from context
    const environment = this.node.tryGetContext('environment') || 'dev';

    // Reference the environment-specific secret
    const secretArn = this.node.tryGetContext(`${environment}:dbSecretArn`);

    if (!secretArn) {
      throw new Error(`Secret ARN for ${environment} not found in context`);
    }

    const secret = secretsmanager.Secret.fromSecretAttributes(this, 'DbSecret', {
      secretCompleteArn: secretArn,
    });

    const lambdaFunction = new lambda.Function(this, 'MyFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        SECRET_ARN: secret.secretArn,
      },
    });

    secret.grantRead(lambdaFunction);
  }
}
```

Then provide the secret ARNs via context when you deploy:

```bash
cdk deploy -c environment=prod -c prod:dbSecretArn=arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db/password-ABC123
```

Or store them in a `cdk.context.json` file (though again, never store the actual secret value, only the ARN):

```json
{
  "environment": "prod",
  "prod:dbSecretArn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db/password-ABC123",
  "dev:dbSecretArn": "arn:aws:secretsmanager:us-east-1:123456789012:secret:dev/db/password-XYZ789"
}
```

This pattern keeps your CDK code generic while allowing environment-specific secrets without hardcoding any sensitive values.

### Common Pitfalls and How to Avoid Them

**Logging secrets accidentally.** If you print a secret to CloudWatch Logs or application logs, you've compromised it. Be especially careful when debugging. Use IAM policies to restrict who can read logs, and consider using CloudWatch Logs Insights with sensitive data masking.

**Forgetting to grant IAM permissions.** Your Lambda function or EC2 instance won't be able to call Secrets Manager unless you explicitly grant permission. Use `secret.grantRead()` in CDK, or manually add an IAM policy with `secretsmanager:GetSecretValue` action on the secret ARN.

**Storing the secret ARN in plaintext configurations.** While the ARN itself isn't a credential, storing it in a public repository or unsecured config file can help attackers identify secrets worth stealing. Treat ARNs with care and restrict who can access them.

**Not considering network connectivity.** If your Lambda function runs in a VPC and tries to access Secrets Manager over the internet, you need a NAT Gateway or VPC endpoint for Secrets Manager. Without it, the function can't reach Secrets Manager.

**Assuming synthesis-time secrets are safe.** If you fetch secrets during CDK synthesis, they end up in your shell history, CI/CD logs, or local machine. Always fetch secrets at runtime in production.

### Conclusion

Hardcoding secrets is tempting because it's quick. But the security consequences are severe and lasting. AWS provides mature services like Secrets Manager and Parameter Store specifically to solve this problem, and CDK integrates seamlessly with both.

The recommended pattern is clear: never store secrets in code or configuration files. Reference them by ARN in your CDK stack, grant IAM permissions to your application, and retrieve secrets at runtime. This approach provides strong security, supports automatic rotation, and keeps your infrastructure code clean and deployable.

When you next reach for the keyboard to paste a database password into a config file, pause. Use Secrets Manager instead. Your future self—and your security team—will thank you.
