---
title: "Elastic Beanstalk Secrets Management: Storing Credentials in Environment Variables and Secrets Manager"
---

## Elastic Beanstalk Secrets Management: Storing Credentials in Environment Variables and Secrets Manager

When you deploy an application to AWS Elastic Beanstalk, you inevitably need to manage sensitive data—database passwords, API keys, OAuth tokens, and other credentials that your application requires to function. How you handle these secrets can make the difference between a secure, maintainable deployment and a vulnerability waiting to happen. This article walks you through the practical approaches to secrets management in Beanstalk, exploring both the convenience and pitfalls of environment variables, and then showing you how to integrate AWS Secrets Manager for enterprise-grade credential handling.

### Understanding the Secrets Challenge in Beanstalk

Beanstalk abstracts much of the infrastructure complexity away, but it doesn't eliminate the need to think carefully about how credentials flow through your application. Every application needs to authenticate to something—a database, an external API, a message queue. The question is: where do these credentials come from, and how do you ensure they're secure?

The traditional approach many developers reach for first is environment variables. They're simple, they're language-agnostic, and Beanstalk makes them trivially easy to set. You open the Beanstalk console, navigate to configuration, add a few environment variables, and your application can access them through the standard mechanism of your runtime (e.g., `process.env` in Node.js, `os.environ` in Python). This simplicity is both a strength and a weakness.

### Environment Variables: The Quick Start and Its Limits

Let's start with the straightforward approach because it's how many developers begin their Beanstalk journey. Setting environment variables through the Beanstalk console is as simple as it gets.

When you navigate to your Beanstalk environment's configuration page and select the "Software" section, you'll find an environment properties area. Here, you can define key-value pairs that Beanstalk injects into the EC2 instances running your application at deployment time. For a Node.js application connecting to a PostgreSQL database, you might set:

```
DB_HOST=my-database.c9akciq32.us-east-1.rds.amazonaws.com
DB_PORT=5432
DB_USER=admin
DB_PASSWORD=MyComplexPassword123!
DB_NAME=production_db
```

Your application code then reads these directly:

```javascript
const pg = require('pg');

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

client.connect();
```

This works. Your application gets its credentials. Deployment proceeds. But there's a catch that becomes more apparent the longer you operate this way.

### The Security Implications of Environment Variables

While environment variables in Beanstalk are reasonably secure during transmission and storage (Beanstalk stores them encrypted at rest and transmits them securely), the visibility problem emerges once they're in use.

First, these variables are visible in the Beanstalk console itself. Any developer or operator with access to view the environment's configuration can read your database password in plaintext. This might be acceptable in a small team, but it violates the principle of least privilege and creates audit trail challenges. Who accessed the password? When?

Second, environment variables leak into logs and error messages. If your application crashes or generates verbose logs, those environment variables often end up captured. Stack traces, debug output, and application logs frequently include the full environment in many frameworks. A developer looking at CloudWatch logs might unintentionally expose credentials to other team members or systems that aggregate those logs.

Third, environment variables are visible to anyone who gains shell access to an EC2 instance, even with limited privileges. The `env` command or `printenv` will display them. If an attacker compromises a container or instance, the credentials are immediately available.

For these reasons, environment variables work well for non-sensitive configuration—API endpoints, feature flags, environment names—but they're not ideal for secrets. That's where AWS Secrets Manager enters the picture.

### Introducing AWS Secrets Manager

AWS Secrets Manager is a purpose-built service for managing secrets at scale. Instead of storing credentials as environment variables, your application retrieves them from Secrets Manager at runtime. This approach offers several advantages:

Secrets Manager encrypts secrets at rest using AWS KMS, and you can rotate them automatically without changing your application code. It maintains audit logs of who accessed which secret and when. You can also restrict access using IAM policies—only the specific Beanstalk environment or application needs permission to retrieve the secret, not every developer on the team.

The process works like this: you create a secret in Secrets Manager, configure your Beanstalk environment's IAM role to have permission to retrieve that secret, and then your application code calls the Secrets Manager API to fetch the credential at runtime. When you rotate the secret in Secrets Manager, your application automatically gets the new value on its next retrieval.

### Setting Up Secrets Manager for Beanstalk

Creating a secret in Secrets Manager is straightforward. Using the AWS CLI:

```bash
aws secretsmanager create-secret \
  --name prod/database/credentials \
  --description "PostgreSQL database credentials for production" \
  --secret-string '{"username":"admin","password":"MyComplexPassword123!","host":"my-database.c9akciq32.us-east-1.rds.amazonaws.com","port":5432,"dbname":"production_db"}'
```

This creates a secret named `prod/database/credentials` containing a JSON object with all your database connection details. Secrets Manager stores this encrypted.

Next, your Beanstalk environment's EC2 instances need permission to retrieve this secret. Beanstalk automatically creates an IAM instance profile and role for your environment. You need to attach a policy that grants `secretsmanager:GetSecretValue` permission for your specific secret.

You can apply this policy using the Beanstalk console by modifying the environment's instance profile, or you can manage it through a `.ebextensions` configuration file, which is often cleaner for infrastructure as code.

### Managing Configuration with .ebextensions

The `.ebextensions` directory is a powerful feature many developers underutilize. You create a `.ebextensions` folder in your application root, and Beanstalk processes YAML or JSON configuration files in that directory during deployment.

Here's how you'd set up IAM policy for Secrets Manager access via `.ebextensions`:

```yaml
# .ebextensions/iam_policy.config
Resources:
  SecretsManagerPolicy:
    Type: AWS::IAM::Policy
    Properties:
      PolicyName: SecretsManagerAccess
      Roles:
        - !GetAtt IamInstanceProfile.Roles[0]
      PolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Action:
              - secretsmanager:GetSecretValue
            Resource:
              - arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/database/credentials-*

  IamInstanceProfile:
    Type: AWS::EC2::InstanceProfile
    Properties:
      Path: /
      Roles:
        - !Ref IamRole

  IamRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Service: ec2.amazonaws.com
            Action: sts:AssumeRole
```

With this in place, your environment's instances have permission to retrieve the secret.

### Retrieving Secrets in Application Code

Now your application needs to actually fetch and use the secret. In Python, you might do this:

```python
import boto3
import json

def get_db_credentials():
    client = boto3.client('secretsmanager', region_name='us-east-1')
    
    try:
        response = client.get_secret_value(SecretId='prod/database/credentials')
        secret = json.loads(response['SecretString'])
        return secret
    except Exception as e:
        print(f"Error retrieving secret: {e}")
        raise

credentials = get_db_credentials()
db_connection_string = f"postgresql://{credentials['username']}:{credentials['password']}@{credentials['host']}:{credentials['port']}/{credentials['dbname']}"
```

In Node.js, the pattern is similar:

```javascript
const AWS = require('aws-sdk');

const secretsManager = new AWS.SecretsManager({ region: 'us-east-1' });

async function getDBCredentials() {
  try {
    const response = await secretsManager.getSecretValue({ SecretId: 'prod/database/credentials' }).promise();
    return JSON.parse(response.SecretString);
  } catch (error) {
    console.error('Error retrieving secret:', error);
    throw error;
  }
}

const credentials = await getDBCredentials();
const connectionString = `postgresql://${credentials.username}:${credentials.password}@${credentials.host}:${credentials.port}/${credentials.dbname}`;
```

There's a performance consideration here: calling Secrets Manager on every request adds latency. A typical call takes 100-200 milliseconds. For applications that need sub-millisecond latency, you should cache the secret in memory and only refresh it periodically or when rotation occurs.

### AWS Lambda Powertools and Secrets Retrieval

If you're building serverless applications alongside or instead of traditional Beanstalk deployments, AWS Lambda Powertools is worth knowing about. Lambda Powertools is an open-source library that makes working with Lambda and AWS services more ergonomic, including a secrets module that handles caching automatically.

With Lambda Powertools for Python, retrieving a secret looks like this:

```python
from aws_lambda_powertools.utilities.secrets import SecretsManager

secrets = SecretsManager()
secret = secrets.get('prod/database/credentials')
```

The library caches the secret in memory for a configurable duration (default 3600 seconds) and only calls Secrets Manager again when the cache expires. This is perfect for Lambda, where execution context might persist across multiple invocations.

For Node.js, the equivalent approach is:

```javascript
const { SecretsManager } = require('@aws-lambda-powertools/parameters/secrets');

const secretsManager = new SecretsManager();
const secret = await secretsManager.get('prod/database/credentials');
```

While Lambda Powertools was designed for Lambda, the caching patterns it implements are applicable to any application running in Beanstalk, and many developers adopt similar caching strategies in their non-serverless code.

### Handling Multiple Environments

Most production deployments span multiple environments—development, staging, production. Each needs its own set of credentials. Rather than creating separate secrets for each environment, a cleaner approach is to use secret naming conventions and environment-specific retrieval.

In your Beanstalk configuration, store the environment name as an environment variable:

```
APP_ENV=production
```

Then your application constructs the secret ID dynamically:

```python
import os
import boto3
import json

environment = os.environ.get('APP_ENV', 'development')
secret_name = f"{environment}/database/credentials"

client = boto3.client('secretsmanager')
response = client.get_secret_value(SecretId=secret_name)
credentials = json.loads(response['SecretString'])
```

This way, your code doesn't change between environments—only the `APP_ENV` variable differs, and Secrets Manager automatically serves the right secret based on that environment.

### Automatic Rotation with Secrets Manager

One of Secrets Manager's most powerful features is automatic secret rotation. You configure a Lambda function that Secrets Manager invokes on a schedule (typically every 30 days), and that function rotates the secret by generating a new value and updating both Secrets Manager and your underlying resource (e.g., your RDS database).

For a typical RDS database rotation, AWS provides pre-built Lambda rotation functions that you simply enable through the Secrets Manager console. When rotation occurs, the Lambda function changes the database password, updates the secret in Secrets Manager, and tests that the new credentials work. Your application doesn't need to do anything—it simply gets the new credentials on its next retrieval.

This is a significant security advantage over static environment variables, which often remain unchanged for years.

### Best Practices and Patterns

**Combine approaches thoughtfully.** Non-sensitive configuration like API endpoints, database hosts, and feature flags belong in environment variables. Secrets belong in Secrets Manager. Don't put everything in Secrets Manager—that's unnecessary and adds latency everywhere.

**Cache secrets appropriately.** Calling Secrets Manager adds latency. Cache secrets in application memory for a reasonable duration (e.g., 5-60 minutes depending on your tolerance for secret rotation latency). Implement a refresh mechanism triggered either by time or by manual signals.

**Test secret retrieval.** In your deployment pipeline, verify that your Beanstalk environment can actually retrieve the secrets it needs before declaring the deployment successful. A common mistake is getting the IAM policy wrong, and the application fails at runtime when it can't retrieve the secret.

**Use secret versioning.** Secrets Manager maintains versions automatically. If you need to roll back to a previous secret value, you can do so via the console or API.

**Audit secret access.** Enable CloudTrail to log all Secrets Manager API calls. Monitor these logs to detect unusual secret access patterns.

**Avoid embedding secrets in Docker images.** If you're using Docker with Beanstalk, never bake secrets into your Docker image or compose files. Retrieve them at runtime from Secrets Manager.

### Troubleshooting Common Issues

When integrating Secrets Manager with Beanstalk, a few problems are worth knowing about.

**Permission denied when retrieving secrets:** Double-check your IAM policy. The most common mistake is forgetting the `-*` wildcard at the end of the secret ARN. Secrets Manager automatically appends a version suffix to secret names, so your policy must match that pattern.

**Secrets not found errors:** Verify the secret exists in the correct region. Beanstalk and the secret must be in the same region. If they're not, you'll get a `ResourceNotFoundException`.

**Timeout errors on secret retrieval:** This usually indicates network connectivity issues between your Beanstalk instances and the Secrets Manager endpoint. Ensure your VPC security groups allow outbound HTTPS (port 443) traffic to the Secrets Manager service, or use VPC endpoints for Secrets Manager if you require a private network.

**Stale secrets after rotation:** If your application is caching secrets without a time-based refresh, it might miss rotation events. Always include a mechanism to refresh cached secrets periodically.

### Conclusion

Secrets management in Elastic Beanstalk spans a spectrum from simple environment variables to sophisticated integration with AWS Secrets Manager. Environment variables are fine for non-sensitive configuration and work well for small teams where visibility and audit concerns are minimal. However, for production systems handling sensitive credentials like database passwords and API keys, AWS Secrets Manager provides encryption, automatic rotation, granular access control, and comprehensive audit trails.

The practical approach is to use environment variables for configuration and Secrets Manager for secrets, leverage `.ebextensions` to wire up IAM permissions, cache secrets in application memory to manage latency, and enable automatic rotation for long-lived credentials. This combination gives you security, scalability, and operational simplicity—the foundation of a mature AWS deployment.

As you grow your AWS deployments, these patterns become increasingly valuable. The infrastructure overhead of integrating Secrets Manager is minimal, but the security and compliance benefits compound over time.
