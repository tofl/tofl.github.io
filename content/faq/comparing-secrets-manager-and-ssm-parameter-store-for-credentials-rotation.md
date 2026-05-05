---
title: "Comparing Secrets Manager and SSM Parameter Store for Credentials Rotation"
---

## Comparing Secrets Manager and SSM Parameter Store for Credentials Rotation

When you're building applications on AWS, managing secrets securely isn't optional—it's foundational. But choosing *how* to manage them involves real tradeoffs. Two services dominate this space: AWS Secrets Manager and AWS Systems Manager Parameter Store. Both can encrypt your credentials with KMS, both integrate deeply with the AWS ecosystem, and both appear in architecture diagrams everywhere. Yet they're fundamentally different tools optimized for different problems, and the wrong choice can leave you either overpaying or under-protected.

This article cuts through the marketing to help you make an informed decision. We'll compare these services across the dimensions that actually matter to developers and architects—rotation capabilities, cost, application integration, and audit trails. You'll walk away understanding not just the differences, but the business logic behind them.

### Understanding the Core Purpose of Each Service

Before diving into comparison, it's important to recognize that Secrets Manager and Parameter Store weren't designed to solve the same problem, even though they often compete for the same use cases.

**Parameter Store** is Systems Manager's general-purpose tool for storing configuration data, feature flags, license keys, database hostnames, and yes—even encrypted secrets. It's lightweight, deeply integrated with IAM for access control, and it won't cost you anything if you stay within the free tier (up to 10,000 standard parameters). Think of it as the Swiss Army knife of AWS configuration management.

**Secrets Manager** is a specialized service purpose-built for managing secrets—particularly database passwords, API keys, and other credentials that need to be rotated regularly. It assumes from the start that your secrets will change, that you'll want to audit every access, and that you might need to share them securely across AWS accounts. It's the focused specialist rather than the generalist.

This distinction matters because it shapes everything else: the feature set, the pricing model, and the operational patterns you'll need to adopt.

### The Rotation Problem and Why It Matters

Here's where things get genuinely interesting. If your database password or API key never changes, security posture becomes a game of risk management. The longer a credential exists unchanged in the wild, the greater the odds it's been compromised, discovered in logs, or leaked somehow. The industry best practice is to rotate credentials regularly—changing them on a schedule or when you suspect compromise.

Parameter Store has *no native rotation capability*. If you want to rotate a secret stored there, you need to write the logic yourself: create new credentials in the downstream system (like RDS), update the parameter, coordinate the cutover, and handle the inevitable failure modes. This is entirely feasible—many teams do it with Lambda functions and CloudWatch Events—but it's extra code you maintain, test, and debug.

Secrets Manager includes automated rotation as a first-class feature. You define a Lambda function that knows how to rotate a specific type of secret (database password, API key, etc.), and Secrets Manager orchestrates the entire process on a schedule you specify. When rotation happens, Secrets Manager:

1. Calls your rotation Lambda with the current secret
2. Waits for the Lambda to update the secret in the target system
3. Validates that the new secret works
4. Marks the old secret as deprecated but keeps it available briefly for in-flight requests

From an application perspective, this is elegant: your code always calls `GetSecretValue` and receives the current, valid credential. You don't need to track versions or handle rotation logic. Secrets Manager handles the complexity.

### Application Code: How Rotation Affects Your Architecture

This difference in approach has real implications for how you write application code.

With **Secrets Manager**, your application code is straightforward:

```python
import boto3
import json

client = boto3.client('secretsmanager', region_name='us-east-1')

def get_db_credentials():
    response = client.get_secret_value(SecretId='prod/mysql/password')
    secret = json.loads(response['SecretString'])
    return secret['username'], secret['password']

# Later in your code
username, password = get_db_credentials()
db = connect(host='mydb.rds.amazonaws.com', user=username, password=password)
```

You call `GetSecretValue`, you get back the current, valid secret, and you move on. Rotation happens transparently in the background. If you implement caching (which you should for performance), Secrets Manager even provides a client-side cache with built-in TTL handling.

With **Parameter Store**, if you want automatic rotation, you're building it yourself. A typical pattern involves storing multiple versions and having your code poll for updates:

```python
import boto3
import json

ssm_client = boto3.client('ssm', region_name='us-east-1')

def get_db_credentials():
    # Get the parameter, and optionally cache it with your own TTL logic
    response = ssm_client.get_parameter(
        Name='/prod/mysql/password',
        WithDecryption=True
    )
    secret = json.loads(response['Parameter']['Value'])
    return secret['username'], secret['password']

# You're responsible for:
# 1. Detecting when rotation has occurred
# 2. Fetching new credentials
# 3. Closing stale connections
# 4. Handling the window where old and new credentials coexist
```

Neither approach is inherently wrong—Parameter Store is perfectly serviceable for many workloads. But Secrets Manager abstracts away a significant amount of operational complexity, especially as your infrastructure scales.

### Understanding the Cost Model

Cost is often the primary factor in choosing between these services, so let's be precise.

**Parameter Store pricing:**
- **Free tier:** up to 10,000 standard parameters, unlimited API calls
- **Beyond free tier:** $0.04 per advanced parameter per month

For most developers, this is functionally free. You'd need to hit a very large scale or deliberately use advanced features to incur charges.

**Secrets Manager pricing:**
- **Per secret:** $0.40 per secret per month (prorated for partial months)
- **API calls:** $0.05 per 10,000 API calls beyond free tier

Let's work through realistic scenarios to understand when each service makes financial sense.

**Scenario 1: Small startup with 10 secrets**

You're managing 10 database passwords, API keys, and SSH keys. You call `GetSecretValue` roughly 1,000 times per month across all your servers and Lambda functions.

- Secrets Manager: (10 secrets × $0.40) + ($0.05 per 10,000 calls) = $4.00/month
- Parameter Store: $0.00/month
- Monthly savings with Parameter Store: $4.00

This is the scenario where Parameter Store's free tier dominates. If you don't need rotation, there's simply no financial justification for Secrets Manager.

**Scenario 2: Mid-market company with 100 secrets and rotation**

You're managing database passwords, OAuth credentials, encryption keys, and API secrets across 20+ environments (dev, staging, prod, etc.). You've implemented automated rotation for compliance reasons. You're making 50,000 API calls per month.

- Secrets Manager: (100 secrets × $0.40) + (50,000 calls ÷ 10,000 × $0.05) = $40 + $0.25 = $40.25/month
- Parameter Store: $0.00 (still within free tier)
- Monthly savings with Parameter Store: $40.25

However, you'd need to implement and maintain rotation logic yourself. If your rotation Lambda runs twice monthly per secret, that's roughly 200 Lambda invocations. At typical pricing (1 million invocations = $0.20), that's negligible cost. But developer time? That's significant. You're spending engineering effort to save $40/month—a poor trade unless you're a cost-optimization-obsessed startup.

**Scenario 3: Enterprise with 500 secrets, rotation, and compliance auditing**

You're managing secrets across multiple AWS accounts, multiple regions, and you need detailed audit trails for compliance (SOC 2, HIPAA, PCI-DSS, etc.). Rotation happens weekly. You're making 500,000 API calls monthly across all your systems.

- Secrets Manager: (500 secrets × $0.40) + (500,000 calls ÷ 10,000 × $0.05) = $200 + $2.50 = $202.50/month
- Parameter Store: $0.00
- Monthly savings with Parameter Store: $202.50

But here's where the math inverts. Secrets Manager's built-in rotation removes the need for custom Lambda orchestration across accounts. Parameter Store offers no cross-account secret sharing without custom IAM and copying secrets between accounts. The audit trail in Secrets Manager logs every access to CloudTrail. Implementing equivalent logging with Parameter Store requires custom Lambda functions and additional CloudTrail configuration.

The true cost of Parameter Store here includes:
- Multiple Lambda functions for rotation orchestration (~20-40 hours development)
- Custom cross-account sharing mechanism (~15-20 hours)
- Integration with SIEM or audit system (~10-15 hours)
- Ongoing maintenance and debugging

At fully-loaded developer costs (~$150/hour), you're looking at $8,000-$9,000 in engineering expense to save $202.50/month. You'd need nearly 4 years to break even, and by then your compliance requirements will have shifted.

### Diving Deeper: Rotation Implementation Patterns

If you're serious about choosing between these services, understanding how rotation actually works is essential.

**Secrets Manager's rotation model** is opinionated. You provide a Lambda function that implements four phases:

1. **CreateSecret** – Generate the new credential in the target system
2. **SetSecret** – Configure the application or service to use the new credential
3. **TestSecret** – Verify the new credential actually works
4. **FinishSecret** – Complete the rotation by marking the old version deprecated

Secrets Manager orchestrates these phases, managing the state machine, handling retries, and providing CloudTrail audit entries for each step. If a phase fails, rotation is halted and you're alerted.

Here's what a real rotation Lambda for an RDS password might look like:

```python
import boto3
import pymysql
import json

secrets_client = boto3.client('secretsmanager')
rds_client = boto3.client('rds')

def lambda_handler(event, context):
    service = event['ClientRequestToken']
    secret_id = event['SecretId']
    step = event['ClientRequestToken']
    
    # Retrieve the secret
    secret = secrets_client.get_secret_value(SecretId=secret_id)
    secret_dict = json.loads(secret['SecretString'])
    
    if step == 'create':
        # Generate new password
        new_password = secrets_client.get_random_password(
            PasswordLength=32,
            ExcludeCharacters='/@"\\'
        )['RandomPassword']
        
        # Update RDS password (this is pseudo-code; real implementation varies by DB engine)
        rds_client.modify_db_cluster_parameter_group(
            DBClusterParameterGroupName='prod-cluster',
            Parameters=[{
                'ParameterName': 'password',
                'ParameterValue': new_password,
                'ApplyMethod': 'immediate'
            }]
        )
        
    elif step == 'set':
        # Update the secret in Secrets Manager with the new version
        secrets_client.put_secret_value(
            SecretId=secret_id,
            ClientRequestToken=service,
            SecretString=json.dumps({
                **secret_dict,
                'password': new_password
            }),
            VersionStages=['AWSCURRENT']
        )
        
    elif step == 'test':
        # Verify connectivity with the new credential
        try:
            connection = pymysql.connect(
                host=secret_dict['host'],
                user=secret_dict['username'],
                password=new_password,
                database=secret_dict['dbname']
            )
            connection.close()
        except Exception as e:
            raise Exception(f"Failed to connect with rotated password: {str(e)}")
            
    elif step == 'finish':
        # Mark rotation complete
        secrets_client.update_secret_version_stage(
            SecretId=secret_id,
            VersionStage='AWSCURRENT',
            MoveToVersionId=service
        )
```

This is nontrivial code, but crucially: Secrets Manager handles calling it, managing failures, and orchestrating the entire lifecycle. You don't need to schedule it, track state, or manually retry.

If you were implementing this with Parameter Store, you'd build a Lambda that does all of the above *plus* handles scheduling, state management, and error recovery yourself. You'd likely use EventBridge to trigger rotation on a schedule, and you'd need custom logic to coordinate updates across your infrastructure.

### SecureString vs. Secrets Manager: A Critical Distinction

One persistent confusion: "Parameter Store has SecureString encryption with KMS, so why do I need Secrets Manager?"

This is a perfectly reasonable question that deserves a clear answer. SecureString and Secrets Manager's KMS encryption are *not* substitutes—they're orthogonal features serving different purposes.

**SecureString** encrypts the parameter value at rest using KMS. Your parameter `my-api-key` is stored encrypted in the Parameter Store database. When you call `get_parameter` with `WithDecryption=True`, Parameter Store decrypts it and returns the plaintext. Access is controlled via IAM—you grant `ssm:GetParameter` permissions.

**Secrets Manager with KMS** also encrypts values at rest. But it adds rotation, automatic version management, cross-account sharing, and a specialized audit trail.

The encryption itself is similar. The surrounding ecosystem is completely different.

Think of it this way: a SecureString parameter is a locked box. Secrets Manager is a locked box with a combination lock that automatically changes the combination every 30 days.

If your secret never needs to rotate and you're managing fewer than 100 secrets, the locked box (SecureString) is entirely sufficient. If rotation is a compliance requirement or best practice you want to adopt, the combination lock (Secrets Manager) is necessary.

### Cross-Account Access: A Hidden Complexity

In larger organizations, you often need to share secrets across AWS accounts. Perhaps your database is in Account A, but your application servers are in Account B, and you want application code to pull credentials from Account B's Secrets Manager instance while accessing Account A's database.

**Secrets Manager handles this explicitly.** You can grant cross-account access using a resource-based policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT-B-ID:role/ApplicationRole"
      },
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:us-east-1:ACCOUNT-A-ID:secret:prod/db/password-*"
    }
  ]
}
```

The cross-account principal can now retrieve the secret, and every access is logged in Account A's CloudTrail.

**Parameter Store** requires you to manage cross-account access manually. You'd typically implement a Lambda function in Account A that reads the parameter and returns it (with appropriate IAM controls), then create an API Gateway endpoint, or manually copy parameters between accounts. It's doable but clunky.

For enterprises managing secrets across 5, 10, or 50 AWS accounts, Secrets Manager's built-in cross-account capability alone justifies the $0.40/secret/month cost.

### Audit Trails and Compliance

If you're subject to compliance requirements (SOC 2, PCI-DSS, HIPAA, etc.), the audit trail is non-negotiable.

Secrets Manager automatically logs all access to CloudTrail. When any principal calls `GetSecretValue`, you have a CloudTrail record with:
- The exact timestamp
- The IAM principal making the request
- The secret accessed
- Whether the request succeeded
- From which IP/user agent (for console access)

This is invaluable for compliance audits. You can query CloudTrail to show "who accessed the production database password, when, and from where?"

Parameter Store also logs to CloudTrail, but there's a critical difference: Parameter Store logs all API calls indiscriminately. If you store 100 parameters and each is accessed 1,000 times daily, you have 100,000 CloudTrail log entries per day. Sifting through that to find "who accessed the production secret" is tedious.

Secrets Manager's logs are inherently focused—they're about secrets, and they're structured for audit purposes. Some organizations find this so valuable that they use Secrets Manager exclusively for actual secrets (rotating credentials) and Parameter Store for non-sensitive configuration.

### The Decision Framework

After working through all of this, here's how to decide:

**Use Parameter Store if:**
- Your secret never rotates (e.g., a third-party API key that rarely changes)
- You're storing 10-50 secrets total
- You're not subject to compliance requirements mandating rotation or detailed audit trails
- You value simplicity and zero cost over operational convenience

**Use Secrets Manager if:**
- You need automatic rotation (for any reason—compliance or security best practice)
- You're managing more than 50 secrets
- You need cross-account access patterns
- You're subject to SOC 2, PCI-DSS, HIPAA, or similar compliance frameworks
- You want built-in audit logging without custom tooling
- The $40-200/month cost is immaterial compared to your infrastructure spend

**Use both (the hybrid approach) if:**
- You have non-sensitive configuration (database hostnames, feature flags) that you store in Parameter Store
- You have rotating credentials (database passwords, API keys) in Secrets Manager
- This is actually quite common in mature organizations

### Beyond Price: Hidden Costs and Benefits

Cost analysis often overlooked by simple comparison spreadsheets:

**Operational burden** is the hidden cost of Parameter Store rotation. Each rotation implementation requires custom code, testing, monitoring, and debugging. A seemingly simple task—rotating a database password—becomes a miniature project with failure modes to handle. As you scale to dozens of secrets and multiple environments, this burden compounds.

**Speed of implementation** favors Secrets Manager. Setting up rotation with Secrets Manager means defining a Lambda function and configuring a few parameters. Within hours, you have automated rotation. With Parameter Store, you're writing code, building state machines, and handling edge cases.

**Vendor lock-in** is often cited as a Parameter Store advantage, but this is somewhat mythical. Neither service is particularly difficult to migrate from. If you're storing credentials in KMS-encrypted Secrets Manager, migrating to another service means decrypting, exporting, and re-encrypting elsewhere. It's not painful, just a one-time operational task.

**Scalability** matters as you grow. Secrets Manager scales seamlessly to thousands of secrets. Parameter Store does too, but at scale, managing rotation across that many secrets without Secrets Manager becomes unwieldy.

### Real-World Patterns and Lessons Learned

From organizations using both services in production, a few patterns emerge:

**Pattern 1: Baseline + Premium** – Store all configuration in Parameter Store (hostnames, ports, feature flags), and only true rotating credentials in Secrets Manager. This optimizes cost while providing rotation where it matters.

**Pattern 2: Secrets Manager-first** – Larger organizations standardize on Secrets Manager for all secrets, accepting the modest per-secret cost as a rounding error in their infrastructure budget, in exchange for uniform patterns, audit trails, and built-in rotation.

**Pattern 3: Hybrid by environment** – Development and staging environments use Parameter Store for cost; production uses Secrets Manager for rotation and compliance.

The most expensive failure mode is choosing Parameter Store for "cost reasons," then discovering in a compliance audit that you lack audit trails, don't have rotation capability, or can't easily share secrets across accounts. The retrofit is expensive and disruptive.

### Conclusion

Secrets Manager and Parameter Store solve different problems, even when they appear interchangeable. Parameter Store is AWS's general-purpose configuration store with encryption support. Secrets Manager is AWS's specialized credentials management service with rotation baked in.

The cost difference—roughly $0.40/secret/month for Secrets Manager versus free for Parameter Store—often obscures a deeper truth: Secrets Manager's built-in rotation, cross-account sharing, and audit trails save you engineering time and operational complexity. The financial breakeven point depends on your scale and complexity, but most organizations managing more than 50 secrets or subject to compliance requirements find Secrets Manager's cost entirely justified.

The decision isn't really about money; it's about whether you want to build and maintain custom rotation logic or let AWS handle it. For many teams, that trade-off is obvious. For others, the simplicity and cost of Parameter Store is the right choice. The key is making the decision deliberately, not by accident.
