---
title: "29. Secrets Manager & SSM Parameter Store"
type: docs
weight: 2
---

## Secrets Manager & SSM Parameter Store

Applications constantly need access to sensitive configuration: database passwords, API keys, OAuth tokens, and feature flags. Hardcoding these into source code or environment variables is a well-known security risk. AWS provides two services to solve this: **Secrets Manager** for sensitive credentials that need lifecycle management (rotation, auditing, cross-account sharing), and **SSM Parameter Store** for general-purpose configuration storage, including secrets. Knowing which to reach for — and when — is a frequently tested decision on the DVA-C02 exam.

### Secrets Manager

Secrets Manager [🔗](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html) is purpose-built for storing, managing, and automatically rotating credentials. Every secret is encrypted at rest using a KMS key (either an AWS-managed key or a CMK you control).

**Secret rotation** is the standout feature. Secrets Manager can rotate credentials automatically on a schedule you define. Rotation works by invoking a **Lambda function** that performs a four-step lifecycle: `createSecret`, `setSecret`, `testSecret`, `finishSecret`. AWS provides managed rotation functions for common databases (RDS, Redshift, DocumentDB) so you often don't need to write one from scratch [🔗](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html). When rotation runs, the secret is updated in place, and any application fetching the secret by name automatically gets the new value on its next retrieval — no deployment required.

**Cross-account access** is supported through resource-based policies. You attach a policy directly to a secret granting a principal in another account `secretsmanager:GetSecretValue`. This is useful in multi-account architectures where a central secrets account manages credentials consumed by workload accounts.

A practical example: an e-commerce application needs a PostgreSQL password. You store the password in Secrets Manager, attach it to the RDS instance, and configure a 30-day rotation schedule. The Lambda rotation function updates the RDS user's password and stores the new value in Secrets Manager. Application code retrieves the secret at startup — no human ever needs to know the actual password.

### SSM Parameter Store

SSM Parameter Store [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html) is a broader configuration store. It holds both non-sensitive configuration (feature flags, environment names, AMI IDs) and sensitive values (passwords, tokens) encrypted via KMS using the `SecureString` parameter type.

Parameters are organised into a **hierarchy** using path-style names: `/myapp/prod/db-password`, `/myapp/prod/api-url`. This makes it easy to retrieve all configuration for a given environment in a single API call (`GetParametersByPath`) rather than fetching each value individually.

Parameter Store has two tiers [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/parameter-store-advanced-parameters.html):

- **Standard tier** — up to 10,000 parameters, max 4 KB per value, no additional charge.
- **Advanced tier** — up to 100,000 parameters, max 8 KB per value, supports **parameter policies** (TTL-based expiration and expiration notifications via EventBridge). There is a small per-parameter monthly cost.

### Secrets Manager vs SSM Parameter Store

This comparison is heavily tested. Here is the practical decision framework:

| Concern | Secrets Manager | SSM Parameter Store |
|---|---|---|
| Automatic credential rotation | ✅ Native, Lambda-driven | ❌ Must implement yourself |
| Cost | ~$0.40/secret/month + API calls | Free (standard tier) |
| Encryption | Always KMS | Optional (`SecureString` for sensitive values) |
| Cross-account access | ✅ Resource-based policies | Limited |
| General app config (non-secret) | Overkill | ✅ Ideal |
| Parameter hierarchy / bulk retrieval | ❌ | ✅ `GetParametersByPath` |

**Rule of thumb:** use Secrets Manager when you need rotation or fine-grained auditing of credentials. Use Parameter Store for everything else — especially non-sensitive config and when cost is a constraint.

### Runtime Retrieval Pattern (Exam Favourite)

A critical design decision that surfaces repeatedly on the exam: **fetch secrets and configuration at Lambda initialisation time, not inside the handler**.

Lambda execution environments are reused across invocations (the "warm start" behaviour). Code placed outside the handler function runs once during initialisation and is then cached for the lifetime of that execution environment. Fetching a secret inside the handler means an API call to Secrets Manager or Parameter Store on *every* invocation — adding latency and API cost at scale.

```python
import boto3
import json

# Runs once at init time — result is cached across warm invocations
client = boto3.client('secretsmanager')
secret = json.loads(
    client.get_secret_value(SecretId='prod/myapp/db')['SecretString']
)

def handler(event, context):
    # Uses the cached secret — no API call here
    db_password = secret['password']
    ...
```

For SSM Parameter Store, the same principle applies. You can also use the **AWS Parameters and Secrets Lambda Extension** [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/ps-integration-lambda-extensions.html), which runs as a Lambda layer, caches parameter values locally, and serves them over a local HTTP endpoint — avoiding repeated SDK calls entirely.

### SSM Session Manager, Run Command, and Patch Manager

SSM goes beyond configuration storage. **Session Manager** [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html) lets you open a shell session to an EC2 instance through the AWS console or CLI without opening port 22, maintaining a bastion host, or managing SSH keys. Access is controlled through IAM, and all session activity is logged to CloudWatch or S3. It is the preferred secure access pattern for EC2 in modern AWS architectures.

**Run Command** lets you execute shell scripts or AWS-provided documents (SSM Documents) across a fleet of EC2 instances without SSH — useful for one-off administrative tasks. **Patch Manager** automates the process of patching managed instances on a schedule, tracking compliance across your fleet. Both are worth knowing at a conceptual level for the exam [🔗](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-patch.html).