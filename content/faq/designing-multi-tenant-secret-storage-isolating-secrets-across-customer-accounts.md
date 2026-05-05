---
title: "Designing Multi-Tenant Secret Storage: Isolating Secrets Across Customer Accounts"
---

## Designing Multi-Tenant Secret Storage: Isolating Secrets Across Customer Accounts

Building a Software-as-a-Service (SaaS) platform means juggling the secrets of many different customers—database passwords, API keys, OAuth tokens, encryption keys—while ensuring that no customer ever sees another's sensitive data. This is where the architecture of your secret storage becomes critical. AWS Secrets Manager provides the foundational capability, but the real challenge lies in designing a system that enforces strict isolation, remains cost-efficient at scale, and handles the practical reality of sharing some secrets across customers when necessary.

In this article, we'll explore how to architect a multi-tenant secret storage solution that keeps each customer's credentials properly isolated while maintaining operational simplicity. Whether you're building a SaaS application from scratch or refactoring an existing one, these patterns will help you implement secrets management that scales without becoming unwieldy.

### Understanding the Multi-Tenant Secret Challenge

Before diving into implementation, it's worth understanding why secret isolation matters so much in a multi-tenant environment. Unlike a single-tenant application where you might have just a handful of secrets to manage, a SaaS platform with hundreds or thousands of customers creates a sprawling landscape of credentials. Database passwords, third-party API keys, encryption keys for customer data, and OAuth tokens all need to be stored securely, rotated on schedule, and accessed only by the right services at the right time.

The fundamental tension in multi-tenant secret management is between two competing pressures: isolation and efficiency. You want complete isolation so that a compromised customer's secrets don't jeopardize others, but you also want to avoid creating a chaotic system where managing 10,000 individual secrets becomes operationally infeasible.

AWS Secrets Manager handles the encryption and lifecycle management side—your secrets are encrypted at rest using AWS Key Management Service (KMS) and can be automatically rotated on a schedule you define. But Secrets Manager itself doesn't have built-in multi-tenancy features. That's where thoughtful architecture comes in. The isolation layer is provided by AWS Identity and Access Management (IAM) policies, which determine which principals (users, roles, or services) can retrieve which secrets.

### Designing Your Secret Naming Convention

The first architectural decision is how you'll name your secrets. This might seem like a minor detail, but a good naming convention becomes the backbone of your isolation strategy.

The pattern we recommend is hierarchical: `/customer/{customerId}/{secretType}`. For example, a customer with ID `cust-12345` might have secrets like:

- `/customer/cust-12345/db-password`
- `/customer/cust-12345/api-key-stripe`
- `/customer/cust-12345/oauth-token-salesforce`
- `/customer/cust-12345/encryption-key`

This structure offers several advantages. First, it makes the customer boundary explicit in the secret name itself, which aids debugging and auditing. Second, it allows you to use wildcards in IAM policies—a pattern we'll explore shortly. Third, it scales mentally; as you add more secrets, the hierarchy keeps them organized without requiring a centralized registry.

For secrets that genuinely need to be shared across multiple customers—like a single Stripe API key that you use on behalf of several customers—consider a separate namespace: `/shared/stripe-api-key` or `/shared/third-party/twilio-token`. This makes it immediately obvious which secrets have a broader scope, and it simplifies your IAM policies by keeping shared and per-customer secrets visually distinct.

Some teams also include a region prefix if they operate in multiple AWS regions: `/us-east-1/customer/cust-12345/db-password`. This helps prevent confusion when troubleshooting cross-region deployments, though it does add a layer of complexity if you replicate secrets across regions.

### Enforcing Isolation with IAM Policies and Resource Tags

Once your secrets have a clear naming convention, IAM policies become your enforcement mechanism. The goal is simple in principle: each customer's service role should be able to access only that customer's secrets.

Here's a typical IAM policy for a customer service role. Imagine your application runs on Amazon ECS or Amazon Lambda, and you've created a service role that these workloads assume when they start. You want that role to be able to retrieve only the secrets for its specific customer:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:/customer/cust-12345/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:/shared/*"
    }
  ]
}
```

This policy grants the role permission to retrieve secrets matching the ARN pattern for customer `cust-12345`, plus any shared secrets. The wildcard at the end of the ARN means that regardless of the specific secret type (db-password, api-key-stripe, etc.), the policy allows access. If the role tried to retrieve `/customer/cust-67890/db-password`, the GetSecretValue call would fail with an access denied error.

For workloads that don't know their customer ID at deployment time—perhaps you have a shared service that serves multiple customers and needs to look up the customer from the request—you'll need a slightly different approach. One pattern is to use IAM policy conditions with context variables or to pass the customer ID as an environment variable and have your code construct the ARN dynamically before calling Secrets Manager.

An alternative approach leverages AWS resource tags. You can tag each secret with a key like `customer` and a value like `cust-12345`. Then, use an IAM policy condition to grant access only to secrets with a matching customer tag:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "secretsmanager:ResourceTag/customer": "${aws:PrincipalTag/customer}"
        }
      }
    }
  ]
}
```

This policy says: "Allow GetSecretValue on any secret in Secrets Manager, but only if the secret's `customer` tag matches the role's `customer` tag." For this to work, your service roles must also be tagged with a `customer` tag. This approach is more flexible if your naming convention changes or if you need to support multiple secrets per customer with varying prefixes.

Both approaches work; the choice depends on your operational preferences. The naming-based approach (using ARN wildcards) is simpler to reason about and doesn't require maintaining tags. The tag-based approach is more flexible and scales better if you have complex organizational structures or need to grant access across multiple resource types (not just secrets, but also S3 buckets, DynamoDB tables, etc.).

### Implementing Least-Privilege Access in Practice

Least privilege means that each role gets exactly the permissions it needs—no more, no less. In the context of secrets, this manifests in a few ways.

First, differentiate between the actions your application needs. Most applications only need to retrieve secrets via `GetSecretValue`. However, some operational tools might need to list secrets with `ListSecrets` or describe them with `DescribeSecret`. Don't grant all three to every role. If your application needs to list secrets to discover which ones are available, you've already lost the battle—your application should know exactly which secrets it needs and request them by name.

Second, consider whether your application truly needs the ability to retrieve secrets for multiple customers. Often, architectural separation means that each customer's workload (whether it's a microservice instance, Lambda function, or container task) is isolated and only handles requests for that one customer. If you can enforce this isolation at the infrastructure level, your IAM policies become even simpler: the role for customer A's workload simply gets access to customer A's secrets, full stop.

Third, be cautious with wildcard permissions. A policy like `Resource: "arn:aws:secretsmanager:*:*:secret:*"` is effectively the same as giving unrestricted access. Scope your wildcards tightly. If you use the naming convention pattern `/customer/{customerId}/*`, the wildcard is constrained to that customer's hierarchy, which is acceptable.

Fourth, regularly audit your IAM policies. Use AWS Access Analyzer to identify overly permissive policies, and periodically review which roles actually access which secrets using CloudTrail logs. You might discover that a role hasn't accessed a particular secret in six months, which could indicate that the permission is no longer needed.

### Managing the Cost of Many Secrets

Here's a practical reality: Secrets Manager charges per secret per month. At the time of writing, the base cost is $0.40 per secret per month in most regions, with additional charges for API calls. For a SaaS platform with 1,000 customers and five secrets per customer, that's 5,000 secrets × $0.40 = $2,000 per month just in secret storage costs. Add 10,000 customers, and you're looking at $20,000 per month before considering API call costs.

This cost structure creates a natural architectural question: how granular should your secrets be?

One approach is to store related secrets together in a single Secrets Manager secret that contains a JSON object with multiple key-value pairs. For example, instead of creating separate secrets for `/customer/cust-12345/db-password` and `/customer/cust-12345/db-username`, you could create a single secret `/customer/cust-12345/db-credentials` that contains:

```json
{
  "username": "db_user_cust_12345",
  "password": "super_secret_password_here",
  "host": "db.example.com",
  "port": 5432,
  "database": "customer_db_12345"
}
```

This reduces your secret count and thus your monthly costs. The tradeoff is that your application needs to parse the JSON and extract the specific key it needs, and if you want to rotate only the password while keeping the username the same, you'll need custom rotation logic instead of relying on Secrets Manager's native rotation handlers.

Another cost-optimization pattern is to use shared secrets for truly shared resources. If all your customers use the same Stripe account, a single shared Stripe API key costs far less than duplicating it 1,000 times. However, be careful not to use shared secrets as a lazy way to avoid proper isolation. Shared secrets should be the exception, not the rule.

For very large scale operations, some teams use a hybrid approach: they store per-customer secrets in a cheaper system (like encrypted environment variables or a private S3 bucket with encryption and versioning) for non-sensitive defaults, and reserve Secrets Manager for credentials that need automatic rotation or frequent updates. However, this introduces additional complexity and potential security risks if not implemented carefully. For most SaaS platforms, the cleaner approach is to optimize your secret structure rather than introducing multiple secret storage systems.

### Architectural Patterns for Secret Retrieval at Scale

How your application retrieves secrets has implications for both performance and security. Let's explore a few patterns.

**Direct Retrieval Pattern**

The simplest approach is for your application to call `GetSecretValue` on Secrets Manager every time it needs a secret. This ensures you always have the latest version and is straightforward to implement:

```python
import boto3
import json

secrets_client = boto3.client('secretsmanager')

def get_db_password(customer_id):
    secret_name = f"/customer/{customer_id}/db-password"
    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
        return response['SecretString']
    except secrets_client.exceptions.ResourceNotFoundException:
        raise Exception(f"Secret not found: {secret_name}")
```

The downside is that every API call incurs a cost and a small latency penalty. For an application handling thousands of requests per second, this can add up quickly.

**Caching Pattern**

A more efficient approach is to cache secrets in memory with a reasonable time-to-live (TTL). You might cache a secret for 5 or 10 minutes, and only fetch a new copy when the cache expires. This dramatically reduces API call costs and improves latency:

```python
import time

class SecretCache:
    def __init__(self, ttl_seconds=600):
        self.cache = {}
        self.ttl = ttl_seconds
    
    def get(self, secret_name):
        now = time.time()
        if secret_name in self.cache:
            value, timestamp = self.cache[secret_name]
            if now - timestamp < self.ttl:
                return value
        
        # Fetch from Secrets Manager
        response = secrets_client.get_secret_value(SecretId=secret_name)
        secret_value = response['SecretString']
        self.cache[secret_name] = (secret_value, now)
        return secret_value

cache = SecretCache(ttl_seconds=600)

def get_db_password(customer_id):
    secret_name = f"/customer/{customer_id}/db-password"
    return cache.get(secret_name)
```

The tradeoff is that if a secret is rotated, your application won't see the new value until the cache expires. For most use cases, a 5-10 minute cache window is acceptable; credentials don't need to be refreshed with sub-second latency. However, if you're rotating secrets frequently or need immediate propagation, you might want a shorter TTL or additional refresh logic.

**Lambda Secrets Extension Pattern**

If you're running on AWS Lambda, AWS provides a built-in Secrets Manager extension that handles caching for you. The extension runs as a Lambda layer and exposes a local HTTP endpoint that your code can call to retrieve secrets. The extension caches results and automatically manages TTL, reducing both API calls and the complexity of your application code:

```python
import json
import urllib3

def lambda_handler(event, context):
    http = urllib3.PoolManager()
    secret_name = f"/customer/{customer_id}/db-password"
    
    # Call the local extension endpoint
    url = f"http://localhost:2773/secretsmanager/get?secretId={secret_name}"
    response = http.request('GET', url, headers={
        'X-Aws-Parameters-Secrets-Token': os.environ.get('AWS_SESSION_TOKEN')
    })
    
    secret = json.loads(response.data)
    password = secret['SecretString']
    # Use password...
```

The extension is transparent to your code and handles all the caching and refresh logic behind the scenes. This is a great option if Lambda is your primary compute platform.

**Batch Retrieval Pattern**

If your application needs multiple secrets at startup or at regular intervals, you could batch them together rather than making individual API calls. However, Secrets Manager doesn't have a batch get operation, so you'd need to either make multiple serial calls (slower but simpler) or parallelize the requests:

```python
import concurrent.futures

def get_customer_secrets(customer_id, secret_types):
    secret_names = [f"/customer/{customer_id}/{s}" for s in secret_types]
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = {
            executor.submit(
                secrets_client.get_secret_value, 
                SecretId=name
            ): name for name in secret_names
        }
        
        secrets = {}
        for future in concurrent.futures.as_completed(futures):
            response = future.result()
            secrets[futures[future]] = response['SecretString']
    
    return secrets
```

This reduces the total time if you need multiple secrets and can tolerate some latency, but it's more complex than the caching approach and may not be necessary if you're already caching.

For most SaaS platforms, the caching pattern or Lambda extension approach strikes the right balance between performance, cost, and simplicity.

### Handling Cross-Customer Secret Sharing

In a purely isolated multi-tenant system, each customer's secrets would be completely separate. However, the real world often requires exceptions. A shared API key for a third-party service, a common encryption key for specific operations, or a license key that applies to multiple customers all create scenarios where you need to share secrets.

The key principle is: make sharing intentional and auditable. Don't accidentally grant permissions too broadly; explicitly design for the secrets that need to be shared.

One approach is a tiered naming scheme. You might have:

- `/customer/{customerId}/*` — secrets unique to a customer
- `/shared/product/*` — shared secrets that serve a specific product line
- `/shared/vendor/{vendorName}/*` — shared credentials for third-party integrations

Then, your IAM policies can grant access to the specific shared secrets each customer needs:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:/customer/cust-12345/*"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:/shared/vendor/stripe/*"
    }
  ]
}
```

This policy grants customer `cust-12345` access to its own secrets and to shared Stripe secrets, but not to other shared secrets or other customers' secrets.

Another pattern is to use a central secrets fetcher service that has broader permissions. This service sits between your customer-facing applications and Secrets Manager. When a customer application needs a secret, it calls the fetcher service with its customer ID and the secret name. The fetcher validates that the customer is allowed to access that secret (by checking a permission matrix in a database or configuration file), and if so, retrieves it from Secrets Manager.

```python
# Fetcher service with broader Secrets Manager permissions
@app.post('/secrets/{customer_id}/{secret_name}')
def get_secret(customer_id, secret_name):
    # Check permissions in database
    if not is_customer_allowed_secret(customer_id, secret_name):
        return {'error': 'Unauthorized'}, 403
    
    # Retrieve from Secrets Manager
    response = secrets_client.get_secret_value(
        SecretId=f"/customer/{customer_id}/{secret_name}"
    )
    return {'value': response['SecretString']}
```

This pattern is more complex but provides a centralized point for enforcing sharing rules and auditing access. It's useful in larger organizations where secret access policies need to be dynamic or context-dependent.

### Secret Rotation in a Multi-Tenant Environment

Secrets Manager supports automatic rotation through Lambda functions. You provide a Lambda function that knows how to update a secret (for example, by calling your database and changing the password), and Secrets Manager invokes it on a schedule you define.

In a multi-tenant environment, rotation introduces additional complexity. You need to either:

1. Create separate rotation functions for each customer, each with its own database credentials and connection details. This doesn't scale well.

2. Create a single rotation function that is parameterized by the secret name and can rotate secrets for any customer. This function must have broad permissions and careful input validation to avoid accidental cross-customer access.

3. Use a hybrid approach where a central rotation orchestrator (perhaps a custom service or Step Functions state machine) handles the business logic, and customer-specific Lambda functions handle the low-level rotation operations.

For most SaaS platforms, option 2—a parameterized, well-validated rotation function—is the most practical:

```python
def lambda_handler(event, context):
    # Secrets Manager provides these fields
    service = event['ClientRequestToken']  # Rotation ID
    secret_id = event['SecretId']  # e.g., /customer/cust-12345/db-password
    step = event['ClientRequestToken']  # current step
    
    # Extract customer ID from secret ARN
    # ARN format: arn:aws:secretsmanager:region:account:secret:/customer/cust-12345/db-password-xxxxx
    customer_id = extract_customer_id(secret_id)
    
    # Validate that the customer is allowed to rotate this secret
    # (Implicit in IAM permissions, but good to double-check)
    if not is_valid_customer(customer_id):
        raise Exception(f"Invalid customer: {customer_id}")
    
    # Proceed with rotation
    # Connect to that customer's database and update password
    ...
```

The critical point is input validation. Before using the customer ID extracted from the secret name, validate it against your customer database or configuration. This prevents a compromised rotation function from rotating secrets for arbitrary customers.

Additionally, ensure your rotation function's IAM role is scoped narrowly. It should be able to call `GetSecretValue` and `UpdateSecretVersionStage` on secrets matching the pattern `/customer/*`, but not on shared secrets or resources outside of Secrets Manager.

### Auditing and Monitoring Secret Access

In a multi-tenant system, auditing who accessed which secrets is critical for both security and compliance. AWS CloudTrail logs all Secrets Manager API calls, including GetSecretValue, and you can analyze these logs to understand access patterns.

A simple CloudTrail query might look like:

```
{
  "eventName": "GetSecretValue",
  "requestParameters": {
    "secretId": "/customer/cust-12345/*"
  }
}
```

This would show you all requests to retrieve secrets for customer `cust-12345`. You can run this query regularly (perhaps as a daily Lambda function) to detect anomalies, such as a service accessing secrets for a customer it shouldn't or unusual bursts of secret retrievals that might indicate an attack.

Beyond CloudTrail, consider publishing Secrets Manager metrics to Amazon CloudWatch. You can create alarms for suspicious activity, such as:

- A high number of failed GetSecretValue requests (might indicate a misconfigured role or an attacker attempting to guess secret names)
- A role accessing secrets for multiple customers in a short time window (might indicate a compromised application)
- Access to secrets outside normal business hours

These alarms, combined with centralized logging, give you visibility into the health and security of your secret storage infrastructure.

### A Complete Example: Building a Multi-Tenant Secrets Wrapper

Let's tie these concepts together with a practical example. Here's a wrapper class that a SaaS application might use to retrieve secrets safely and efficiently:

```python
import boto3
import json
import logging
import time
from functools import lru_cache

logger = logging.getLogger(__name__)
secrets_client = boto3.client('secretsmanager')

class MultiTenantSecretManager:
    def __init__(self, cache_ttl_seconds=600, max_cache_size=1000):
        self.cache_ttl = cache_ttl_seconds
        self.cache = {}
        self.max_cache_size = max_cache_size
    
    def get_secret(self, customer_id, secret_type):
        """
        Retrieve a secret for a specific customer.
        
        Args:
            customer_id: The unique customer identifier
            secret_type: The type of secret (e.g., 'db-password', 'api-key-stripe')
        
        Returns:
            The secret value as a string
        """
        secret_name = f"/customer/{customer_id}/{secret_type}"
        
        # Check cache first
        cached_value = self._get_from_cache(secret_name)
        if cached_value is not None:
            logger.info(f"Cache hit for {secret_name}")
            return cached_value
        
        # Fetch from Secrets Manager
        logger.info(f"Fetching secret {secret_name} from Secrets Manager")
        try:
            response = secrets_client.get_secret_value(SecretId=secret_name)
            secret_value = response['SecretString']
            
            # Try to parse as JSON (some secrets might be JSON objects)
            try:
                return json.loads(secret_value)
            except json.JSONDecodeError:
                # If not JSON, return as string
                return secret_value
        
        except secrets_client.exceptions.ResourceNotFoundException:
            logger.error(f"Secret not found: {secret_name}")
            raise Exception(f"Secret not found: {secret_name}")
        except Exception as e:
            logger.error(f"Error retrieving secret {secret_name}: {e}")
            raise
        finally:
            # Cache the result
            self._set_in_cache(secret_name, secret_value)
    
    def get_shared_secret(self, secret_name):
        """
        Retrieve a shared secret (not scoped to a specific customer).
        
        Args:
            secret_name: The full secret name (e.g., '/shared/vendor/stripe/api-key')
        
        Returns:
            The secret value
        """
        cached_value = self._get_from_cache(secret_name)
        if cached_value is not None:
            return cached_value
        
        try:
            response = secrets_client.get_secret_value(SecretId=secret_name)
            secret_value = response['SecretString']
            self._set_in_cache(secret_name, secret_value)
            return secret_value
        except Exception as e:
            logger.error(f"Error retrieving shared secret {secret_name}: {e}")
            raise
    
    def _get_from_cache(self, secret_name):
        now = time.time()
        if secret_name in self.cache:
            value, timestamp = self.cache[secret_name]
            if now - timestamp < self.cache_ttl:
                return value
            else:
                del self.cache[secret_name]
        return None
    
    def _set_in_cache(self, secret_name, value):
        if len(self.cache) >= self.max_cache_size:
            # Simple eviction: remove oldest entry
            oldest_key = min(self.cache, key=lambda k: self.cache[k][1])
            del self.cache[oldest_key]
        
        self.cache[secret_name] = (value, time.time())

# Usage in your application
secret_manager = MultiTenantSecretManager(cache_ttl_seconds=600)

def connect_to_customer_database(customer_id):
    password = secret_manager.get_secret(customer_id, 'db-password')
    connection_string = f"postgresql://user:{password}@db.example.com/customer_db"
    return psycopg2.connect(connection_string)

def send_email_via_sendgrid(customer_id, to, subject, body):
    api_key = secret_manager.get_secret(customer_id, 'api-key-sendgrid')
    # Use api_key to send email...

def charge_customer_via_stripe():
    # Stripe API key is shared across all customers
    stripe_key = secret_manager.get_shared_secret('/shared/vendor/stripe/api-key')
    # Use stripe_key...
```

This wrapper handles caching, error logging, and the distinction between per-customer and shared secrets. Your application code stays clean, and the complexity of secret retrieval is encapsulated in a single class.

### Key Takeaways and Best Practices

Designing multi-tenant secret storage boils down to a few core principles. First, establish a clear naming convention that makes customer boundaries explicit and supports wildcards in IAM policies. Second, use IAM policies and tags to enforce strict isolation, granting each role access only to the secrets it genuinely needs. Third, optimize for cost and performance by considering how granular your secrets should be and whether caching is appropriate for your access patterns.

Fourth, make cross-customer secret sharing intentional and rare. Use separate namespaces for shared secrets, audit their access, and regularly validate that the sharing is still necessary. Finally, invest in auditing and monitoring. CloudTrail logs, CloudWatch metrics, and regular access reviews help you catch misconfigurations or attacks early.

As you scale your SaaS platform, these architectural decisions compound. A decision to use one secret per customer instead of five saves money and complexity. A decision to implement caching rather than calling Secrets Manager on every request dramatically improves both performance and cost. And a commitment to least-privilege access, enforced through IAM policies, prevents the kind of cross-tenant data leaks that can be catastrophic for a SaaS business.

The good news is that AWS Secrets Manager and IAM provide all the primitives you need. The architecture you build on top of them is where the real value lies.
