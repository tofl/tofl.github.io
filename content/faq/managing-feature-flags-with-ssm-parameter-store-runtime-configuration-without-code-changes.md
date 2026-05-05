---
title: "Managing Feature Flags with SSM Parameter Store: Runtime Configuration Without Code Changes"
---

## Managing Feature Flags with SSM Parameter Store: Runtime Configuration Without Code Changes

Feature flags—sometimes called feature toggles or feature switches—are one of the most powerful tools in a modern developer's toolkit. They allow you to change application behavior at runtime without redeploying code, which means you can safely release features, gradually roll out changes to users, run A/B tests, and quickly disable problematic functionality without triggering a deployment pipeline. AWS Systems Manager Parameter Store makes implementing this pattern remarkably straightforward, especially when combined with Lambda, EC2, and containerized workloads.

In this article, we'll explore how to build a robust feature flag system using Parameter Store, understand the caching patterns that make it performant, integrate with AppConfig for coordinated rollouts, and monitor flag changes in real time. Whether you're preparing for advanced AWS work or simply want to implement safer deployment practices, this guide will give you the practical knowledge to do it effectively.

### Why Parameter Store for Feature Flags?

Before diving into implementation, it's worth understanding why Parameter Store is a natural choice for managing feature flags. Parameter Store is a managed service that stores configuration data as name-value pairs, with built-in support for encryption, versioning, and access control. Unlike hardcoding flags or managing them in a database, Parameter Store provides several advantages that make it ideal for this use case.

First, Parameter Store is designed for low-latency reads. Parameters can be retrieved in milliseconds, which is essential for a feature flag system where latency directly impacts your application's performance. Second, it integrates seamlessly with AWS Identity and Access Management, so you can restrict who can read or modify flags without touching your application code. Third, it supports both simple string values and more complex JSON documents, giving you flexibility in how you structure your configurations. Finally, it's cost-effective—you can store hundreds or thousands of parameters with minimal monthly cost, and the free tier covers a reasonable number of standard parameters.

The alternative approaches each have trade-offs. Hardcoding flags in your application requires redeployment. Managing flags in a custom database adds operational complexity. Third-party feature flag services offer richer analytics but introduce external dependencies. Parameter Store sits in the sweet spot: it's AWS-native, simple to use, and integrates directly with services you're already using.

### Designing Your Parameter Hierarchy

The key to a maintainable feature flag system is establishing a clear naming convention and hierarchy. AWS recommends using forward slashes to create a logical structure, treating Parameter Store like a filesystem for your configuration.

A typical hierarchy might look like this:

```
/myapp/features/new-checkout-flow
/myapp/features/dark-mode
/myapp/features/advanced-analytics
/myapp/config/database/host
/myapp/config/database/port
/myapp/config/api/timeout
```

Notice how the hierarchy groups related parameters. The `/myapp/` prefix creates a namespace specific to your application, preventing collisions if you have multiple applications in the same AWS account. The `features` folder clearly delineates feature flags from other configuration. Each flag has a descriptive name that indicates its purpose.

This structure offers practical benefits. When you need to list all active features, you can query parameters by path using `/myapp/features` as the prefix. When you want to rotate or update a specific flag, the clear naming makes it obvious which parameter controls which behavior. And if you're collaborating with team members, the hierarchy makes the purpose of each parameter immediately clear.

For more complex scenarios, consider adding an environment dimension:

```
/myapp/prod/features/new-checkout-flow
/myapp/staging/features/new-checkout-flow
/myapp/dev/features/new-checkout-flow
```

This allows you to test features in lower environments before enabling them in production, and you can safely manage different flag states for different deployment stages without any code changes.

### Storing Simple and Complex Feature Flags

Parameter Store supports two parameter types: String and StringList, but the practical choice for feature flags is usually between simple boolean flags and JSON documents.

For a simple true/false flag, the implementation is straightforward:

```bash
aws ssm put-parameter \
  --name /myapp/features/dark-mode \
  --value "true" \
  --type String \
  --overwrite
```

In your application code, you'd retrieve this and parse it as a boolean. The simplicity is appealing—it's easy to toggle from the AWS Console or CLI, and the mental model is clear.

However, many real-world scenarios require more nuance. Perhaps you want to enable a feature only for a specific user segment, or roll it out to a percentage of your traffic. This is where JSON comes in:

```bash
aws ssm put-parameter \
  --name /myapp/features/new-analytics \
  --value '{
    "enabled": true,
    "rollout_percentage": 25,
    "allowed_regions": ["us-east-1", "us-west-2"],
    "excluded_user_ids": ["user-123", "user-456"]
  }' \
  --type String \
  --overwrite
```

Now your application can read this JSON, parse it, and make sophisticated decisions about whether to enable the feature for a given user or request. The beauty of this approach is that you can change the rollout percentage, excluded users, or enabled regions without touching your code—just update the parameter and your application will pick up the change on the next read (assuming you've implemented caching appropriately, which we'll cover next).

### Reading and Caching Flags in Your Application

The way you read flags matters significantly for performance and cost. A naive implementation that calls Parameter Store on every request would work but would be expensive and slow. Instead, you want to implement intelligent caching.

Let's start with a simple Node.js example using the AWS SDK v3:

```javascript
const { SSMClient, GetParameterCommand } = require("@aws-sdk/client-ssm");

const ssmClient = new SSMClient({ region: "us-east-1" });
const featureFlagCache = {};
const CACHE_TTL_MS = 60000; // 60 seconds

async function getFeatureFlag(flagName) {
  const cacheKey = `/myapp/features/${flagName}`;
  const now = Date.now();

  // Check if we have a cached value that hasn't expired
  if (
    featureFlagCache[cacheKey] &&
    now - featureFlagCache[cacheKey].timestamp < CACHE_TTL_MS
  ) {
    return featureFlagCache[cacheKey].value;
  }

  // Cache miss or expired, fetch from Parameter Store
  try {
    const command = new GetParameterCommand({ Name: cacheKey });
    const response = await ssmClient.send(command);
    const value = JSON.parse(response.Parameter.Value);

    // Update cache
    featureFlagCache[cacheKey] = {
      value,
      timestamp: now,
    };

    return value;
  } catch (error) {
    console.error(`Failed to retrieve feature flag ${flagName}:`, error);
    // Return a safe default—usually false to disable the feature
    return { enabled: false };
  }
}

// Usage in your application
async function processCheckout(userId) {
  const checkoutFlag = await getFeatureFlag("new-checkout-flow");

  if (checkoutFlag.enabled && checkoutFlag.allowed_user_ids.includes(userId)) {
    // Use new checkout flow
    return newCheckoutFlow(userId);
  } else {
    // Use legacy checkout flow
    return legacyCheckoutFlow(userId);
  }
}
```

This pattern implements a simple time-based cache. Flags are cached for 60 seconds, which provides a good balance between freshness and efficiency. Most application changes don't require instant propagation, and a one-minute lag is rarely problematic.

For Python, the equivalent using boto3 looks like this:

```python
import json
import time
from datetime import datetime
import boto3

ssm_client = boto3.client('ssm', region_name='us-east-1')
feature_flag_cache = {}
CACHE_TTL_SECONDS = 60

def get_feature_flag(flag_name):
    cache_key = f'/myapp/features/{flag_name}'
    current_time = time.time()

    # Check cache
    if cache_key in feature_flag_cache:
        cached_data = feature_flag_cache[cache_key]
        if current_time - cached_data['timestamp'] < CACHE_TTL_SECONDS:
            return cached_data['value']

    # Cache miss or expired
    try:
        response = ssm_client.get_parameter(Name=cache_key)
        value = json.loads(response['Parameter']['Value'])
        
        # Update cache
        feature_flag_cache[cache_key] = {
            'value': value,
            'timestamp': current_time
        }
        
        return value
    except ssm_client.exceptions.ParameterNotFound:
        print(f"Feature flag {flag_name} not found")
        return {'enabled': False}
    except Exception as e:
        print(f"Error retrieving feature flag: {e}")
        return {'enabled': False}

def process_payment(user_id):
    flag = get_feature_flag('advanced_payment_processing')
    
    if flag.get('enabled', False):
        return process_payment_v2(user_id)
    else:
        return process_payment_v1(user_id)
```

In both examples, notice the error handling. If Parameter Store is temporarily unavailable, the code gracefully falls back to a safe default. This is crucial—you don't want a transient service issue to break your entire application.

### Lambda Cold Starts and Initialization

Lambda presents a special consideration for feature flags. Lambda functions have lifecycle events: cold starts (when the function hasn't run recently and the runtime needs to initialize) and warm starts (when the runtime is already loaded). Cold starts add noticeable latency, making them an opportunity to optimize.

A common pattern is to initialize your feature flag cache at Lambda function load time, outside the handler:

```javascript
const {
  SSMClient,
  GetParametersByPathCommand,
} = require("@aws-sdk/client-ssm");

const ssmClient = new SSMClient({ region: "us-east-1" });
let featureFlags = {};
let flagsInitialized = false;

async function initializeFlags() {
  if (flagsInitialized) return;

  try {
    const command = new GetParametersByPathCommand({
      Path: "/myapp/features",
      Recursive: true,
    });

    const response = await ssmClient.send(command);

    // Build a map of flag names to their values
    response.Parameters.forEach((param) => {
      const flagName = param.Name.split("/").pop();
      featureFlags[flagName] = JSON.parse(param.Value);
    });

    flagsInitialized = true;
  } catch (error) {
    console.error("Failed to initialize feature flags:", error);
    // Continue with empty flags rather than failing entirely
  }
}

// This runs once per container lifecycle
initializeFlags().catch(console.error);

exports.handler = async (event) => {
  // By this point, featureFlags is populated
  const checkoutFlag = featureFlags["new-checkout-flow"] || {
    enabled: false,
  };

  if (checkoutFlag.enabled) {
    return newCheckoutHandler(event);
  } else {
    return legacyCheckoutHandler(event);
  }
};
```

This approach loads all flags once when the Lambda function first starts. The `flagsInitialized` flag prevents re-initialization on subsequent invocations. The trade-off is that changes to flags won't be picked up until the container restarts, but this typically happens automatically as Lambda recycles containers regularly.

If you need more frequent updates, you can implement a hybrid approach:

```javascript
async function getFlagWithRefresh(flagName, maxAge = 300000) {
  // maxAge defaults to 5 minutes
  const flag = featureFlags[flagName];

  if (!flag || Date.now() - flag.lastFetch > maxAge) {
    // Refresh individual flag in the background
    try {
      const response = await ssmClient.send(
        new GetParameterCommand({
          Name: `/myapp/features/${flagName}`,
        })
      );
      const value = JSON.parse(response.Parameter.Value);
      featureFlags[flagName] = {
        value,
        lastFetch: Date.now(),
      };
    } catch (error) {
      console.warn(`Failed to refresh flag ${flagName}`, error);
    }
  }

  return featureFlags[flagName]?.value || { enabled: false };
}
```

This pattern initializes flags at cold start for performance, then periodically refreshes them during the container's lifetime, giving you both speed and freshness.

### Integrating with AppConfig for Coordinated Rollouts

While Parameter Store works well for feature flags, AWS AppConfig adds another layer of sophistication. AppConfig is designed specifically for managing application configuration changes across multiple instances, with support for deployment strategies, validation, and monitoring.

The typical workflow with AppConfig is: you define a configuration profile in AppConfig that references parameters in Parameter Store, set up a deployment strategy (such as immediate deployment or a gradual rollout), and then your application uses the AppConfig agent to fetch and cache the configuration.

Here's how you might structure this:

First, you'd create configuration in Parameter Store as before:

```bash
aws ssm put-parameter \
  --name /myapp/prod/checkout-feature \
  --value '{"enabled": true, "rollout_percentage": 50}' \
  --type String
```

Then you'd create an AppConfig application and configuration profile. While the full setup involves several steps, the key benefit is that AppConfig can coordinate a gradual rollout. You define a deployment strategy like "linear: increase by 10% every 2 minutes", and AppConfig ensures that across your fleet of instances or Lambda functions, the flag is rolled out in a controlled manner.

In your application, you'd use the AppConfig agent:

```javascript
const {
  AppConfigDataClient,
  GetLatestConfigurationCommand,
} = require("@aws-sdk/client-appconfig-data");

const appConfigClient = new AppConfigDataClient({ region: "us-east-1" });
let configurationToken = null;

async function getLatestFeatureConfig() {
  try {
    const response = await appConfigClient.send(
      new GetLatestConfigurationCommand({
        Application: "myapp",
        Environment: "production",
        Configuration: "checkout-features",
        ClientConfigurationVersion: configurationToken,
      })
    );

    if (response.ConfigurationVersion) {
      configurationToken = response.ConfigurationVersion;
      return JSON.parse(response.Configuration);
    }
  } catch (error) {
    console.error("Failed to fetch AppConfig:", error);
  }

  return null;
}
```

The advantage of AppConfig is that it handles the complexity of coordinated rollouts automatically. Rather than manually adjusting percentages in Parameter Store, you define the strategy once, and AppConfig manages the gradual enablement across your infrastructure. It's particularly powerful for larger deployments where you want to minimize risk by gradually rolling out changes.

For many simpler applications, Parameter Store alone is sufficient. AppConfig shines when you're managing complex rollouts across dozens or hundreds of instances.

### Monitoring Flag Changes with CloudWatch Events

Feature flags are only useful if you know when they change. Unexpected flag modifications can indicate either intentional testing or potential security issues. CloudWatch Events (now called EventBridge) allows you to monitor Parameter Store changes and trigger automated responses.

You can create an EventBridge rule that triggers whenever a parameter is modified:

```bash
aws events put-rule \
  --name feature-flag-changes \
  --event-pattern '{
    "source": ["aws.ssm"],
    "detail-type": ["Parameter Store Change"],
    "detail": {
      "operation": ["Create", "Update", "Delete"],
      "name": [{
        "prefix": "/myapp/features/"
      }]
    }
  }'
```

Then attach a target—perhaps an SNS topic to notify your team:

```bash
aws events put-targets \
  --rule feature-flag-changes \
  --targets "Id"="1","Arn"="arn:aws:sns:us-east-1:123456789012:flag-changes"
```

Or send the event to a Lambda function for more sophisticated handling:

```javascript
exports.handler = async (event) => {
  const detail = event.detail;

  console.log(`Feature flag changed: ${detail.name}`);
  console.log(`Operation: ${detail.operation}`);
  console.log(`New value: ${detail.new_value}`);

  // You might trigger a Slack notification, update a log, or trigger a cache refresh
  await notifyTeam(
    `Feature flag updated: ${detail.name} is now ${detail.new_value}`
  );
};
```

This monitoring layer provides visibility into who is changing flags and when. In production, this audit trail is invaluable—it helps you correlate flag changes with application behavior changes and provides accountability.

### Cost Optimization and Best Practices

Parameter Store pricing is straightforward: standard parameters are free, and advanced parameters cost a small monthly fee. Advanced parameters support additional features like parameter policies, larger sizes, and more API throughput. For most feature flag scenarios, standard parameters are sufficient.

However, there are still optimization considerations. Each API call to retrieve a parameter counts toward your rate limit and has a small latency cost. Caching, as discussed earlier, is your primary optimization tool. By caching flags for even short periods (30-60 seconds), you can reduce your API call volume by orders of magnitude.

Consider also using GetParametersByPath to fetch multiple flags in a single API call:

```python
def get_all_feature_flags():
    response = ssm_client.get_parameters_by_path(
        Path='/myapp/features',
        Recursive=True
    )
    
    flags = {}
    for param in response['Parameters']:
        flag_name = param['Name'].split('/')[-1]
        flags[flag_name] = json.loads(param['Value'])
    
    return flags
```

This is more efficient than individual GetParameter calls if you need to read multiple flags. If your application uses dozens of flags, loading them all at startup and caching them locally is significantly more efficient than individual on-demand retrievals.

Another best practice is to set reasonable default values. If Parameter Store is unavailable, your application should still function, just with conservative defaults:

```python
def get_flag_safely(flag_name, default_value=False):
    try:
        # Your normal flag retrieval logic
        return get_flag(flag_name)
    except Exception as e:
        logging.warning(f"Could not retrieve flag {flag_name}, using default", exc_info=e)
        return default_value
```

Version your flag names if you plan to make breaking changes to the flag structure. For instance, if you're going to change a flag from a simple boolean to a complex JSON object, consider creating a new flag like `/myapp/features/checkout-flow-v2` rather than modifying the existing flag. This prevents unexpected breakage if older code versions are still running.

### Real-World Example: Gradual Feature Rollout

Let's tie everything together with a realistic scenario. Imagine you're rolling out a new payment processor to gradually replace the old one:

```bash
# Day 1: Disable for all users
aws ssm put-parameter \
  --name /myapp/features/new-payment-processor \
  --value '{
    "enabled": true,
    "rollout_percentage": 0,
    "fallback_on_error": true
  }' \
  --type String \
  --overwrite

# Day 2: Enable for 5% of users
aws ssm put-parameter \
  --name /myapp/features/new-payment-processor \
  --value '{
    "enabled": true,
    "rollout_percentage": 5,
    "fallback_on_error": true
  }' \
  --type String \
  --overwrite
```

In your application:

```python
import hashlib
import json

def should_use_new_payment_processor(user_id):
    flag = get_feature_flag('new-payment-processor')
    
    if not flag.get('enabled', False):
        return False
    
    # Use user ID hash to determine if this user is in the rollout percentage
    user_hash = int(hashlib.md5(user_id.encode()).hexdigest(), 16)
    user_percentage = (user_hash % 100) + 1
    
    return user_percentage <= flag.get('rollout_percentage', 0)

def process_payment(user_id, amount):
    if should_use_new_payment_processor(user_id):
        try:
            return new_payment_processor.charge(user_id, amount)
        except Exception as e:
            if get_feature_flag('new-payment-processor').get('fallback_on_error'):
                logging.warning(f"New processor failed for {user_id}, falling back", exc_info=e)
                return legacy_payment_processor.charge(user_id, amount)
            else:
                raise
    else:
        return legacy_payment_processor.charge(user_id, amount)
```

Over several days, you gradually increase the rollout percentage: 5% → 10% → 25% → 50% → 100%. If error rates spike at any percentage, you immediately drop it back to 0% without a deployment. This is the power of feature flags—you decouple deployment from activation.

### Conclusion

Feature flags managed through Parameter Store represent a fundamental shift in how you can manage application behavior. By separating deployment from activation, you gain the ability to roll out changes safely, test new features in production with real data and users, and quickly respond to issues without redeploying code.

The practical implementation is straightforward: establish a clear naming hierarchy, cache flags intelligently to minimize API calls, and handle failures gracefully with sensible defaults. For simple use cases, Parameter Store alone is sufficient. As your needs grow more sophisticated, AppConfig provides coordination across distributed systems, and monitoring through EventBridge keeps your team informed.

The combination of these AWS services gives you a production-ready feature flag system that's secure (integrated with IAM), observable (monitored via CloudWatch), and efficient (both in terms of performance and cost). Whether you're running serverless functions, containerized workloads, or traditional EC2 instances, this pattern scales seamlessly across your infrastructure. Start simple, monitor your flag changes, and as your team gains experience with this pattern, you'll find it becomes indispensable for safe, confident deployments.
