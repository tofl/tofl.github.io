---
title: "AppConfig Validators: JSON Schema and Lambda Custom Validation Examples"
---

## AppConfig Validators: JSON Schema and Lambda Custom Validation Examples

Imagine you've just pushed a new configuration to production, only to discover that a typo in a percentage field has caused your entire pricing system to malfunction. Or perhaps a developer accidentally removed a critical database connection string, and it took your incident response team hours to track down the root cause. These are the kinds of silent failures that keep infrastructure teams awake at night.

This is precisely where AWS AppConfig validators step in. They act as gatekeepers, ensuring that every configuration change is validated before it ever reaches your production systems. In this article, we'll explore how to harness both JSON Schema validators and Lambda-based custom validators to catch configuration errors early, prevent bad deployments, and enforce business rules with precision.

### Understanding AppConfig Validators and Why They Matter

AppConfig validators are the quality assurance layer of your configuration management pipeline. When you deploy a new configuration using AWS AppConfig, the service can run your configuration through one or more validators before making it available to your applications. If validation fails, the deployment is blocked entirely—the bad configuration never makes it to your production environment.

Think of validators as automated code review for your configuration files. Just as you wouldn't want untested code reaching production, you shouldn't want invalid configurations reaching your applications either. The difference is that configuration mistakes often hide longer than code bugs, since many configuration problems only surface under specific load conditions or edge cases.

AppConfig supports two primary validation mechanisms: JSON Schema validators and Lambda validators. JSON Schema is excellent for structural validation—ensuring your configuration follows the right shape, has required fields, and contains values of the correct types. Lambda validators, on the other hand, let you implement complex business logic, perform external validations, and enforce rules that can't be expressed as static schemas.

### JSON Schema Validators: Structure and Constraints

JSON Schema is a declarative language for validating JSON documents. If you haven't encountered it before, think of it as a way to describe what a valid configuration should look like, and then an automated tool checks whether your actual configuration matches that description.

Let's start with a simple but practical example. Suppose you're managing application settings for an e-commerce platform. Your configuration needs to specify minimum and maximum product prices, and these values must be positive numbers.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "E-Commerce Application Config",
  "type": "object",
  "properties": {
    "minProductPrice": {
      "type": "number",
      "minimum": 0.01,
      "description": "Minimum allowed product price in USD"
    },
    "maxProductPrice": {
      "type": "number",
      "minimum": 0.01,
      "description": "Maximum allowed product price in USD"
    },
    "currency": {
      "type": "string",
      "enum": ["USD", "EUR", "GBP"],
      "description": "Currency for all prices"
    }
  },
  "required": ["minProductPrice", "maxProductPrice", "currency"]
}
```

This schema enforces several important constraints. The `type` property ensures that `minProductPrice` and `maxProductPrice` are numbers, not strings or other types. The `minimum` constraint prevents anyone from accidentally setting a zero or negative price. The `enum` property restricts the currency field to only valid options. Most importantly, the `required` array ensures that none of these critical fields can be omitted.

When you attempt to deploy a configuration that violates these constraints—say, you try to set `minProductPrice` to -10—AppConfig's validation engine will reject the deployment and report the specific constraint violation.

One particularly common validation scenario involves percentage values. Many configuration parameters are percentages that should only accept values between 0 and 100. Here's how you'd express that constraint:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Feature Flag Configuration",
  "type": "object",
  "properties": {
    "featureName": {
      "type": "string",
      "minLength": 1,
      "description": "Name of the feature being configured"
    },
    "rolloutPercentage": {
      "type": "integer",
      "minimum": 0,
      "maximum": 100,
      "description": "Percentage of users who should see this feature"
    },
    "enabled": {
      "type": "boolean",
      "description": "Whether the feature is enabled globally"
    }
  },
  "required": ["featureName", "rolloutPercentage"]
}
```

The `minimum` and `maximum` keywords here create a range constraint. Any value outside this range will trigger a validation failure. This is far more reliable than relying on documentation or code review to catch percentage values that exceed 100.

JSON Schema also supports conditional validation through keywords like `if`, `then`, and `else`. Suppose your configuration has a database connection section that should include a password field only when authentication is required:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Database Configuration",
  "type": "object",
  "properties": {
    "host": {
      "type": "string"
    },
    "port": {
      "type": "integer",
      "minimum": 1,
      "maximum": 65535
    },
    "authRequired": {
      "type": "boolean"
    },
    "password": {
      "type": "string",
      "minLength": 8
    }
  },
  "required": ["host", "port", "authRequired"],
  "if": {
    "properties": {
      "authRequired": {
        "const": true
      }
    }
  },
  "then": {
    "required": ["password"],
    "properties": {
      "password": {
        "minLength": 8
      }
    }
  }
}
```

This schema enforces a logical dependency: if `authRequired` is true, then a password field must be present and must be at least 8 characters long. Without authentication, the password field is optional.

### Common JSON Schema Validation Rules and Pitfalls

In practice, you'll encounter certain validation patterns repeatedly. String enumerations are one of the most common. If your application has a finite set of valid log levels, environment names, or region identifiers, you should explicitly enumerate them:

```json
{
  "logLevel": {
    "type": "string",
    "enum": ["DEBUG", "INFO", "WARN", "ERROR"]
  },
  "environment": {
    "type": "string",
    "enum": ["development", "staging", "production"]
  }
}
```

This approach has a significant advantage: if someone tries to deploy a configuration with `logLevel: "VERBOSE"` (a typo or a misremembered level name), the validation will immediately catch it.

Array validation is another common pattern. Suppose your configuration includes a list of allowed IP addresses:

```json
{
  "allowedIps": {
    "type": "array",
    "items": {
      "type": "string",
      "pattern": "^(?:[0-9]{1,3}\\.){3}[0-9]{1,3}$"
    },
    "minItems": 1,
    "description": "List of IP addresses allowed to access the service"
  }
}
```

The `minItems` constraint ensures that you can't deploy an empty allowlist, which would lock everyone out. The `pattern` keyword uses a regular expression to validate that each item looks like an IP address (though for production use, you'd want a more rigorous regex or a custom validator for this).

However, JSON Schema validators do have limitations, and this is where many developers run into trouble. A common pitfall is creating schemas that are either too strict or too loose. A schema that's too strict might reject legitimate configurations due to overly aggressive constraints. For instance, if you validate that all string fields must match a particular pattern, you might inadvertently reject valid values that don't fit your pattern exactly.

Conversely, a schema that's too loose might accept invalid configurations that should be rejected. For example, validating that a numeric field exists but setting no minimum or maximum constraint means any number—including zero or negative values that don't make sense—will pass validation.

Another pitfall is neglecting to validate nested objects. If your configuration has a hierarchical structure with nested properties, you must explicitly define validation rules for those nested levels:

```json
{
  "type": "object",
  "properties": {
    "database": {
      "type": "object",
      "properties": {
        "primary": {
          "type": "object",
          "properties": {
            "host": { "type": "string" },
            "port": { "type": "integer" }
          },
          "required": ["host", "port"]
        }
      },
      "required": ["primary"]
    }
  },
  "required": ["database"]
}
```

Without this explicit nesting and the `required` declarations at each level, a configuration missing critical nested values could slip through validation.

### Lambda Validators: When Structural Validation Isn't Enough

JSON Schema excels at structural validation, but it has boundaries. You cannot use JSON Schema alone to validate that a product's minimum price is less than its maximum price, or to check whether an external service is available, or to enforce complex business rules that depend on multiple conditions.

This is where Lambda validators shine. A Lambda validator is a function you write that receives the configuration content as input and returns either success or failure. The logic inside that function can be as complex as you need it to be.

Let's build a practical Lambda validator for our e-commerce configuration. This validator will check not only that the structure is correct (which JSON Schema handles), but also that business logic constraints are satisfied:

```python
import json

def lambda_handler(event, context):
    """
    Validate e-commerce configuration for business logic constraints.
    
    event['content'] contains the configuration to validate
    """
    try:
        config = json.loads(event['content'])
    except json.JSONDecodeError as e:
        return {
            'valid': False,
            'errors': [f'Invalid JSON: {str(e)}']
        }
    
    errors = []
    
    # Validate that minimum price is less than maximum price
    min_price = config.get('minProductPrice', 0)
    max_price = config.get('maxProductPrice', 0)
    
    if min_price >= max_price:
        errors.append(
            f'minProductPrice ({min_price}) must be less than '
            f'maxProductPrice ({max_price})'
        )
    
    # Validate that rollout percentages add up correctly
    rollouts = config.get('featureRollouts', {})
    total_rollout = sum(rollouts.values())
    
    if total_rollout > 100:
        errors.append(
            f'Total feature rollout percentage ({total_rollout}) '
            f'cannot exceed 100'
        )
    
    # Validate that required service endpoints are reachable
    services = config.get('serviceEndpoints', {})
    unreachable = []
    
    for service_name, endpoint in services.items():
        if not is_service_reachable(endpoint):
            unreachable.append(f'{service_name}: {endpoint}')
    
    if unreachable:
        errors.append(
            f'The following service endpoints are not reachable: '
            f'{", ".join(unreachable)}'
        )
    
    if errors:
        return {
            'valid': False,
            'errors': errors
        }
    
    return {
        'valid': True
    }

def is_service_reachable(endpoint):
    """
    Check if a service endpoint is reachable.
    In production, you'd implement actual HTTP health checks here.
    """
    # Simplified example; real implementation would use requests or urllib
    import socket
    
    try:
        # Extract host and port from endpoint
        if '://' in endpoint:
            endpoint = endpoint.split('://', 1)[1]
        
        host = endpoint.split(':')[0]
        port = int(endpoint.split(':')[1]) if ':' in endpoint else 443
        
        socket.create_connection((host, port), timeout=5)
        return True
    except (socket.timeout, socket.error, ValueError):
        return False
```

This validator enforces several business logic constraints that JSON Schema alone cannot express. It ensures that the minimum price is actually less than the maximum price (a cross-field validation), that feature rollout percentages don't exceed 100 in total, and that critical service endpoints are actually reachable.

Here's another example validator that checks whether configuration changes comply with your organization's security policies:

```python
import json
import re

def lambda_handler(event, context):
    """
    Validate configuration for security compliance.
    """
    try:
        config = json.loads(event['content'])
    except json.JSONDecodeError as e:
        return {'valid': False, 'errors': [f'Invalid JSON: {str(e)}']}
    
    errors = []
    
    # Rule 1: No hardcoded credentials in configuration
    config_str = json.dumps(config).lower()
    credential_patterns = [
        r'password\s*[=:]\s*["\']?[^"\'\s]+',
        r'api[_-]?key\s*[=:]\s*["\']?[^"\'\s]+',
        r'secret\s*[=:]\s*["\']?[^"\'\s]+'
    ]
    
    for pattern in credential_patterns:
        if re.search(pattern, config_str):
            errors.append(
                'Configuration contains hardcoded credentials. '
                'Use AWS Secrets Manager references instead.'
            )
            break
    
    # Rule 2: TLS/HTTPS must be enabled for external connections
    endpoints = config.get('externalServices', {})
    for service_name, config_item in endpoints.items():
        if isinstance(config_item, dict):
            url = config_item.get('url', '')
            if url and not url.startswith('https://'):
                errors.append(
                    f'Service "{service_name}" must use HTTPS. '
                    f'Found: {url}'
                )
    
    # Rule 3: Validate that encryption is enabled for sensitive operations
    if config.get('enableEncryption') is False:
        if config.get('storeSensitiveData') is True:
            errors.append(
                'Cannot store sensitive data with encryption disabled'
            )
    
    if errors:
        return {'valid': False, 'errors': errors}
    
    return {'valid': True}
```

This security-focused validator prevents common mistakes: hardcoded credentials, unencrypted connections, and logical inconsistencies between encryption settings and data sensitivity requirements.

### Combining JSON Schema and Lambda Validators

In most production scenarios, you'll want to use both JSON Schema and Lambda validators together. The JSON Schema validator handles the structural concerns—data types, required fields, enumerations, basic constraints—while the Lambda validator handles the business logic and external validation concerns.

When you configure AppConfig to use validators, you specify them in order. AppConfig will run them sequentially, and if any validator fails, the entire deployment is blocked. This means JSON Schema validation runs first (it's faster and catches obvious structural errors), and then Lambda validation runs only if the schema validation passes.

To set up validators in AppConfig, you define them when creating or updating a configuration profile. Using the AWS CLI, it might look something like this:

```bash
aws appconfig create-configuration-profile \
  --application-id my-app-id \
  --name my-config-profile \
  --location-uri s3://my-bucket/config.json \
  --validators \
    Type=JSON_SCHEMA,Content='{"$schema":"http://json-schema.org/draft-07/schema#",...}' \
    Type=LAMBDA,Arn=arn:aws:lambda:us-east-1:123456789012:function:my-validator
```

The order matters here. If you had expensive Lambda validators, you'd want to ensure JSON Schema catches basic errors first, avoiding unnecessary Lambda invocations.

### Handling Validation Failures and Debugging

When a validator rejects a configuration, AppConfig will not make it available to your applications. Instead, the deployment enters a "failed" state. This is actually the behavior you want—it prevents broken configurations from reaching production.

To debug validation failures, you'll need to check the validator's response. The CloudWatch logs for your Lambda validator will contain detailed error messages that can help you understand what went wrong. When writing validators, you should return clear, specific error messages that tell the developer exactly what's wrong and how to fix it.

Rather than a generic error like "validation failed," provide actionable feedback:

```python
# Bad
return {'valid': False, 'errors': ['Invalid configuration']}

# Good
return {
    'valid': False,
    'errors': [
        'rolloutPercentage must be between 0 and 100 (received: 150)',
        'database.host is required when database.enabled is true'
    ]
}
```

Testing your validators before deploying them is critical. Create a separate development AppConfig application or use local testing to validate your validator logic against various configuration scenarios—including invalid configurations—to ensure your validator correctly accepts valid configs and rejects invalid ones.

### Common Pitfalls and Best Practices

One frequent mistake is creating validators that are too permissive. A validator that only checks that the configuration is valid JSON, for instance, isn't doing much work. You should establish clear validation rules based on your application's requirements and enforce them strictly.

Conversely, validators that are too strict can become burdensome. If your validator rejects configurations for reasons that don't actually affect application correctness, developers will grow frustrated and may attempt to work around the validation system entirely. Strike a balance: validate what truly matters.

Another pitfall is validator code that assumes the configuration structure without defensive checks. If your schema validation didn't catch a missing field, your Lambda validator should gracefully handle it:

```python
# This will crash if 'database' is missing from config
config['database']['host']

# This is safer
database_config = config.get('database', {})
host = database_config.get('host')
```

Performance is also a consideration. If your Lambda validator performs extensive API calls or database lookups, validation deployments will be slow. For external validation, consider caching results or using a timeout to prevent validators from hanging indefinitely.

Finally, remember that validators are part of your operational infrastructure. They should have clear documentation, version control, and testing practices just like your application code. A validator bug that's too permissive can be as damaging as having no validation at all.

### Conclusion

AppConfig validators represent a powerful safeguard in your configuration management strategy. JSON Schema validators efficiently enforce structural constraints and basic business rules, while Lambda validators give you the flexibility to implement complex validation logic, perform external checks, and enforce organizational policies.

The key to effective validation is thoughtfulness: know what constraints actually matter for your application's correctness and security, express those constraints clearly through validators, and ensure your validators provide actionable error messages that guide developers toward fixes. Combined, these practices mean that bad configurations simply cannot reach your production systems—they're caught before they ever have a chance to cause an incident.

As you integrate AppConfig validators into your deployment pipeline, you're investing in configuration governance that will pay dividends in reliability, security, and developer confidence. The time spent crafting good validators is time well spent.
