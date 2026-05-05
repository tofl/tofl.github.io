---
title: "AppConfig Feature Flags Implementation Patterns: Percentage-Based and Attribute-Based Rollouts"
---

## AppConfig Feature Flags Implementation Patterns: Percentage-Based and Attribute-Based Rollouts

Feature flags represent one of the most powerful tools in modern application development, yet many developers treat them as an afterthought. The ability to decouple feature deployment from feature release is transformative—it lets you ship code safely, run experiments with real users, and roll back instantly without redeployment. AWS AppConfig brings this capability to the mainstream, offering a managed service that handles configuration management, validation, and deployment at scale.

This guide walks you through implementing feature flags with AppConfig, from the fundamentals to sophisticated rollout patterns. Whether you're running A/B tests, gradually releasing features to specific user segments, or simply toggling functionality without redeployment, understanding AppConfig's architecture and patterns will make you far more effective at delivering reliable, customer-centric applications.

### Understanding Feature Flags and Why AppConfig Matters

A feature flag is essentially a conditional branch in your code that decides whether to execute a feature based on configuration rather than code changes. Without feature flags, releasing a new feature to a subset of users requires either maintaining separate code branches or deploying different versions—both approaches are error-prone and operationally expensive.

AppConfig simplifies this by providing a centralized service where you define flag configurations, deploy them safely across environments, and consume them in your applications with built-in caching and monitoring. The service handles version control, deployment validation, and integration with monitoring systems, so your team can focus on the feature logic itself.

Think of AppConfig as a sophisticated configuration and deployment platform. You define your feature flags as configuration profiles, AppConfig validates them before deployment, and your application retrieves them through the AppConfig Agent—a lightweight local service that caches values to minimize latency and API calls.

### Configuration Fundamentals: From Simple Flags to Complex Rollout Definitions

The first decision when implementing a feature flag is how to structure the configuration data. For simple use cases, a boolean flag suffices. But real-world feature flag implementations quickly become more sophisticated, requiring support for percentage-based rollouts, attribute-based targeting, and metadata.

#### Simple Boolean Flags

The simplest feature flag configuration is a flat structure with boolean values. Here's an example:

```json
{
  "new_checkout_flow": true,
  "advanced_analytics": false,
  "dark_mode": true
}
```

This approach works well for features that are either globally enabled or disabled. When you retrieve this configuration from AppConfig, you simply check the boolean value and branch your code accordingly. The overhead is minimal—fast lookups, simple logic, easy to reason about.

However, simplicity comes with limitations. You can't specify that a feature should only apply to certain users, or that you want to enable it for 10% of traffic initially before rolling out more broadly. For anything beyond basic on/off switches, you need a richer structure.

#### Complex Configurations with Rollout Strategies

A more flexible approach embeds rollout logic directly into the configuration:

```json
{
  "features": {
    "new_checkout_flow": {
      "enabled": true,
      "rollout": {
        "type": "percentage",
        "percentage": 25,
        "seed": "user_id"
      }
    },
    "premium_tier": {
      "enabled": true,
      "rollout": {
        "type": "attribute",
        "attributes": {
          "account_type": ["enterprise", "pro"]
        }
      }
    },
    "experimental_search": {
      "enabled": false,
      "rollout": {
        "type": "percentage",
        "percentage": 100,
        "seed": "session_id"
      }
    }
  }
}
```

This structure separates the concept of "is this feature generally enabled" from "who should see this feature right now." The `enabled` flag acts as a global kill switch—if it's false, the feature is off everywhere regardless of rollout configuration. This provides a safety mechanism: you can instantly disable a feature across all users without modifying the rollout strategy.

The `rollout` object describes how to distribute the feature. With percentage-based rollouts, you specify what percentage of users should see the feature and which attribute to use as the seed for consistent hashing. With attribute-based rollouts, you define conditions that determine eligibility.

This flexibility enables sophisticated deployment strategies. You can start with 5% of traffic, monitor metrics, and gradually increase to 25%, 50%, and eventually 100% without touching your application code. You can also enable a feature exclusively for beta testers, enterprise customers, or users in specific geographic regions.

### The AppConfig Agent: Architecture and Caching Strategy

AppConfig's architecture centers around the AppConfig Agent, a lightweight daemon that runs locally on your application servers or containers. Understanding how this agent works is crucial for implementing feature flags effectively.

When you configure the AppConfig Agent, you specify which application, environment, and configuration profile to monitor. The agent periodically polls AppConfig (by default every 15 seconds, configurable from 1 second to 24 hours) and downloads the latest configuration. Critically, the agent caches the configuration locally—on disk or in memory—so your application never needs to make a network call to retrieve flags.

This design provides several advantages. First, it eliminates latency. Your code simply reads from the local cache, which is a file system or memory lookup—typically sub-millisecond. Second, it improves resilience. If AppConfig becomes temporarily unavailable, your application continues using the cached configuration. Third, it reduces API load on AppConfig itself.

The polling interval represents a tradeoff between freshness and efficiency. A 15-second interval means configuration changes propagate within approximately 15 seconds on average, with 30 seconds maximum latency (if a change happens right after a poll). For most feature flag use cases, this is acceptable. But if you need near-instantaneous propagation, you can reduce the interval or use CloudWatch Events to trigger immediate refreshes.

Here's how the AppConfig Agent typically runs in a containerized environment:

```bash
# As a sidecar in an ECS task definition
/opt/appconfig-agent \
  --application myapp \
  --environment production \
  --configuration-profile feature-flags \
  --config-location /tmp/appconfig \
  --max-config-size 1048576
```

The agent writes the retrieved configuration to the specified location. Your application then reads from this file. The `max-config-size` parameter prevents the agent from loading excessively large configurations—a safety mechanism for production environments.

### Consuming Feature Flags in Application Code

Once AppConfig delivers your configuration, consuming flags in your application is straightforward. The general pattern involves reading the configuration file or cache, parsing it (usually JSON), and evaluating the flag based on the user context.

Here's a practical implementation in Python:

```python
import json
import hashlib
from typing import Any, Dict, Optional

class FeatureFlagEvaluator:
    def __init__(self, config_path: str):
        """Initialize with path to AppConfig agent output."""
        with open(config_path, 'r') as f:
            self.config = json.load(f)
    
    def is_enabled(self, feature_name: str, user_id: str, 
                   attributes: Optional[Dict[str, Any]] = None) -> bool:
        """
        Evaluate whether a feature is enabled for the given user.
        
        Args:
            feature_name: The feature flag name
            user_id: Unique user identifier for percentage rollouts
            attributes: User attributes for attribute-based rollouts
        
        Returns:
            True if the feature is enabled for this user, False otherwise
        """
        if feature_name not in self.config.get('features', {}):
            # Feature not defined; default to disabled for safety
            return False
        
        feature = self.config['features'][feature_name]
        
        # Global kill switch
        if not feature.get('enabled', False):
            return False
        
        # Evaluate rollout strategy
        rollout = feature.get('rollout', {})
        rollout_type = rollout.get('type', 'percentage')
        
        if rollout_type == 'percentage':
            return self._evaluate_percentage(rollout, user_id)
        elif rollout_type == 'attribute':
            return self._evaluate_attribute(rollout, attributes or {})
        
        # Unknown rollout type; default to disabled
        return False
    
    def _evaluate_percentage(self, rollout: Dict, seed: str) -> bool:
        """Determine if user is in the percentage rollout."""
        percentage = rollout.get('percentage', 0)
        
        # Use consistent hashing based on seed
        hash_obj = hashlib.md5(seed.encode())
        hash_value = int(hash_obj.hexdigest(), 16)
        hash_percentage = (hash_value % 100) + 1
        
        return hash_percentage <= percentage
    
    def _evaluate_attribute(self, rollout: Dict, 
                           attributes: Dict[str, Any]) -> bool:
        """Determine if user matches attribute conditions."""
        conditions = rollout.get('attributes', {})
        
        for attr_name, allowed_values in conditions.items():
            user_value = attributes.get(attr_name)
            if user_value not in allowed_values:
                return False
        
        return True
```

This evaluator handles both core rollout types. For percentage-based rollouts, it uses consistent hashing—the same user always gets the same result because the hash depends only on the seed value. This is critical for A/B testing; you can't have a user see different versions of the feature on different page loads.

Here's how you'd use this in a web framework like Flask:

```python
from flask import Flask, request, jsonify

app = Flask(__name__)
evaluator = FeatureFlagEvaluator('/tmp/appconfig/feature-flags.json')

@app.route('/api/products', methods=['GET'])
def get_products():
    user_id = request.headers.get('X-User-ID', 'anonymous')
    user_attributes = {
        'account_type': request.headers.get('X-Account-Type', 'free'),
        'region': request.headers.get('X-Region', 'us-east-1')
    }
    
    base_products = fetch_products_from_database()
    
    if evaluator.is_enabled('advanced_filtering', user_id, user_attributes):
        # Show enhanced UI with advanced filters
        return jsonify({
            'products': base_products,
            'filters': get_advanced_filters()
        })
    else:
        # Show basic UI
        return jsonify({'products': base_products})
```

Now let's look at a Node.js example:

```javascript
const fs = require('fs');
const crypto = require('crypto');

class FeatureFlagEvaluator {
  constructor(configPath) {
    const configData = fs.readFileSync(configPath, 'utf8');
    this.config = JSON.parse(configData);
  }

  isEnabled(featureName, userId, attributes = {}) {
    const feature = this.config.features?.[featureName];
    
    if (!feature) {
      return false;
    }

    if (!feature.enabled) {
      return false;
    }

    const rollout = feature.rollout || {};
    
    switch (rollout.type) {
      case 'percentage':
        return this.evaluatePercentage(rollout, userId);
      case 'attribute':
        return this.evaluateAttribute(rollout, attributes);
      default:
        return false;
    }
  }

  evaluatePercentage(rollout, seed) {
    const percentage = rollout.percentage || 0;
    
    // Consistent hashing using MD5
    const hash = crypto.createHash('md5').update(seed).digest('hex');
    const hashValue = BigInt('0x' + hash) % 100n;
    
    return Number(hashValue) < percentage;
  }

  evaluateAttribute(rollout, attributes) {
    const conditions = rollout.attributes || {};
    
    for (const [attrName, allowedValues] of Object.entries(conditions)) {
      const userValue = attributes[attrName];
      if (!allowedValues.includes(userValue)) {
        return false;
      }
    }
    
    return true;
  }
}

// Express example
const express = require('express');
const app = express();

const evaluator = new FeatureFlagEvaluator('/tmp/appconfig/feature-flags.json');

app.get('/api/dashboard', (req, res) => {
  const userId = req.get('X-User-ID') || 'anonymous';
  const attributes = {
    accountType: req.get('X-Account-Type') || 'free',
    region: req.get('X-Region') || 'us-east-1'
  };

  if (evaluator.isEnabled('new_dashboard', userId, attributes)) {
    // Render new dashboard
    res.json({ dashboard: renderNewDashboard() });
  } else {
    // Render legacy dashboard
    res.json({ dashboard: renderLegacyDashboard() });
  }
});
```

Both implementations follow the same logical flow: read the configuration, check if the feature is globally enabled, evaluate the rollout strategy based on user context, and return the result. The key insight is that this logic is simple and deterministic—given the same user and attributes, you always get the same answer.

### Percentage-Based Rollouts: A/B Testing and Gradual Rollouts

Percentage-based rollouts enable two distinct deployment patterns that appear similar but serve different purposes: gradual rollouts and A/B tests.

#### Gradual Rollouts for Risk Mitigation

Imagine you've built a new checkout flow that should be faster and more user-friendly. You're confident in the code quality, but production always surprises you. A gradual rollout lets you release to 5% of traffic, monitor error rates and performance metrics, and then increase the percentage as confidence grows.

Here's a realistic AppConfig configuration for this scenario:

```json
{
  "features": {
    "new_checkout_flow": {
      "enabled": true,
      "rollout": {
        "type": "percentage",
        "percentage": 5,
        "seed": "user_id"
      }
    }
  }
}
```

The `seed` value is critical. Using `user_id` ensures that each user consistently sees the same version—if user 12345 is in the 5%, they'll remain in the 5% even after you increase the percentage to 10%. This prevents the jarring experience of users seeing different UI versions on consecutive page loads.

Alternatively, you might use `session_id` as the seed if you want each session to have an independent roll. This is useful when the feature relates to a temporary experience rather than persistent user preferences. For most cases, however, `user_id` is preferred because it provides stable user experiences.

The consistency comes from the hashing algorithm. By hashing the seed value modulo 100, you get a deterministic percentage assignment. User 12345 hashes to 37, so they're always in the 37th percentile. When you increase from 5% to 10%, they remain in the 37th percentile—still included.

Here's how you'd orchestrate a gradual rollout in practice. Start at day one with:

```json
{
  "percentage": 5,
  "seed": "user_id"
}
```

Monitor for 24 hours. If error rates, latency, and business metrics all look healthy, update the configuration:

```json
{
  "percentage": 25,
  "seed": "user_id"
}
```

The AppConfig Agent picks up this change within 15 seconds (or whatever poll interval you've configured). Users in percentiles 1-25 now see the feature. Users who were seeing it before continue to see it; new users randomly distributed across the user base progressively start seeing it.

Continue this process—25% → 50% → 75% → 100%—until everyone has the feature. At that point, you can remove the rollout configuration entirely or mark the feature as fully rolled out by setting percentage to 100.

This approach dramatically reduces the blast radius of any issues. If you discover a bug at 25%, only 25% of your user base is affected. Compare that to a traditional release where you'd push to 100% and potentially impact millions of users.

#### A/B Testing for Experimentation

A/B testing uses the same percentage-based mechanism but with a different goal: not gradual rollout, but experimental comparison. You're not trying to reduce risk; you're trying to measure which version produces better outcomes.

In an A/B test, you split traffic 50/50 between two implementations and measure metrics over a fixed period. The configuration looks similar to a gradual rollout:

```json
{
  "features": {
    "recommendation_algorithm_v2": {
      "enabled": true,
      "rollout": {
        "type": "percentage",
        "percentage": 50,
        "seed": "user_id"
      }
    }
  }
}
```

But the interpretation is different. Rather than gradually increasing to 100%, you maintain 50% for the duration of the experiment—typically one to two weeks, long enough to capture user behavior across different days and times.

Your application code would track which users see each variant and log business metrics like conversion rate, revenue per user, or engagement time. After the experiment period, you analyze the data to see if v2 statistically outperformed v1.

```python
@app.route('/api/recommendations', methods=['GET'])
def get_recommendations():
    user_id = request.headers.get('X-User-ID')
    
    if evaluator.is_enabled('recommendation_algorithm_v2', user_id):
        variant = 'v2'
        recommendations = algorithm_v2.get_recommendations(user_id)
    else:
        variant = 'v1'
        recommendations = algorithm_v1.get_recommendations(user_id)
    
    # Log the variant for analysis
    analytics.log_event('recommendations_served', {
        'user_id': user_id,
        'variant': variant,
        'timestamp': datetime.now()
    })
    
    return jsonify({'recommendations': recommendations})
```

The consistency of the hashing is crucial for A/B testing. Each user must see the same variant throughout the experiment. The statistical validity of your results depends on users not flipping between variants.

If the experiment results show v2 is superior, you can increase the percentage to 100% to roll it out fully. If v1 performs better or v2 shows no improvement, you can lower the percentage back to 0, effectively disabling the new algorithm without code changes.

### Attribute-Based Rollouts: Targeting Specific User Segments

Percentage-based rollouts are powerful, but they're blunt instruments. They treat all users equally, distributing features based purely on a hash. Attribute-based rollouts let you target features to specific segments of your user base based on their characteristics.

Common use cases include:

- Rolling out a feature to enterprise customers before standard tier customers
- Enabling a new payment method only in specific geographic regions due to regulatory requirements
- Providing early access to beta testers for new functionality
- Limiting a computationally expensive feature to accounts with sufficient quota

Here's a comprehensive example combining multiple targeting dimensions:

```json
{
  "features": {
    "real_time_collaboration": {
      "enabled": true,
      "rollout": {
        "type": "attribute",
        "attributes": {
          "account_type": ["enterprise", "pro"],
          "region": ["us-east-1", "eu-west-1"],
          "beta_tester": [true]
        }
      }
    },
    "invoice_automation": {
      "enabled": true,
      "rollout": {
        "type": "attribute",
        "attributes": {
          "account_type": ["enterprise"]
        }
      }
    },
    "new_mobile_ui": {
      "enabled": true,
      "rollout": {
        "type": "attribute",
        "attributes": {
          "platform": ["ios", "android"]
        }
      }
    }
  }
}
```

Note that attribute-based rollouts use AND logic by default. In the `real_time_collaboration` example, a user must have an enterprise or pro account type AND be in either us-east-1 or eu-west-1 AND be a beta tester. If any condition fails, the feature is disabled.

```python
@app.route('/api/documents/<doc_id>/collaborate', methods=['POST'])
def collaborate_on_document(doc_id):
    user_id = request.headers.get('X-User-ID')
    user_attributes = {
        'account_type': get_user_account_type(user_id),
        'region': get_user_region(user_id),
        'beta_tester': is_beta_tester(user_id)
    }
    
    if evaluator.is_enabled('real_time_collaboration', user_id, user_attributes):
        # Use WebSocket for real-time updates
        return jsonify({
            'collaboration': 'enabled',
            'websocket_url': get_websocket_url()
        })
    else:
        # Fall back to polling
        return jsonify({
            'collaboration': 'disabled',
            'polling_interval': 5000
        })
```

One important pattern: you can combine attribute-based and percentage-based rollouts. First, check attribute conditions to determine if the user is in a qualifying segment. Then, within that segment, use percentage-based rollouts to gradually roll out the feature.

```json
{
  "features": {
    "advanced_analytics": {
      "enabled": true,
      "rollout": {
        "type": "combined",
        "attributes": {
          "account_type": ["pro", "enterprise"]
        },
        "percentage": 25,
        "seed": "user_id"
      }
    }
  }
}
```

This configuration first filters to pro and enterprise accounts, then rolls out the feature to 25% of those accounts. The combination gives you both targeting precision and risk mitigation.

### Deploying Feature Flag Configurations with AppConfig

Understanding the consumption patterns is only half the story. You also need to understand how to deploy configurations through AppConfig itself, as this affects how quickly changes propagate and how confident you can be that deployments won't break your application.

AppConfig has several key components you need to orchestrate:

**Configuration Profile** is where you store your feature flag configuration as a document (usually JSON). You create one per environment—development, staging, production—allowing different flags in each environment.

**Deployment Strategy** defines how AppConfig distributes a new configuration version. The immediate strategy applies changes instantly; the linear strategy applies a percentage over time (useful for canary deployments of configuration changes); the exponential strategy applies a percentage exponentially over time (for aggressive canary deployments).

**Validators** are optional but highly recommended. They can validate your configuration against a JSON schema before deployment, preventing syntax errors or invalid structures from reaching your agents.

**Deployment** is the act of promoting a configuration profile version to your environments. AppConfig tracks the version so you can roll back if needed.

Here's a practical deployment workflow:

1. **Create a Configuration Profile** through the AWS Management Console or CLI:

```bash
aws appconfig create-configuration-profile \
  --application-id myapp \
  --name feature-flags \
  --location-uri "s3://my-bucket/feature-flags.json" \
  --description "Feature flag definitions for production"
```

2. **Create a Validator** to ensure configuration validity:

```bash
aws appconfig create-configuration-profile \
  --application-id myapp \
  --name feature-flags \
  --validators '[{
    "Type": "JSON_SCHEMA",
    "Content": "{\"$schema\": \"http://json-schema.org/draft-07/schema#\", \"type\": \"object\", \"properties\": {\"features\": {\"type\": \"object\"}}, \"required\": [\"features\"]}"
  }]'
```

3. **Create a New Configuration Version**:

```bash
aws appconfig create-hosted-configuration-version \
  --application-id myapp \
  --configuration-profile-id feature-flags \
  --content file://feature-flags.json \
  --content-type "application/json"
```

4. **Deploy the Configuration** to production using an exponential strategy for safety:

```bash
aws appconfig start-deployment \
  --application-id myapp \
  --environment-id production \
  --configuration-profile-id feature-flags \
  --configuration-version 1 \
  --deployment-strategy-id AppConfig.Exponential
```

The exponential deployment strategy deserves emphasis. Rather than immediately making the new configuration available to all agents, AppConfig gradually increases the percentage of agents receiving the new configuration. If errors or alerts indicate a problem, you can cancel the deployment. Only healthy agents proceed to receive the configuration.

This sounds similar to a feature flag rollout, but it operates at a different level. You're not rolling out a feature; you're deploying a new configuration to the agents themselves. This protects against syntax errors, schema violations, or configurations that somehow break your application logic.

### Monitoring and Observability for Feature Flags

Deploying feature flags is just the beginning. You need comprehensive visibility into which flags are active, who's seeing which variants, and whether variants are performing as expected.

AppConfig integrates with CloudWatch for monitoring. You can track metrics like deployment success rate, configuration download latency, and the percentage of agents running each configuration version.

More importantly, you should instrument your application to track feature flag usage:

```python
import logging
from functools import wraps

logger = logging.getLogger(__name__)

def log_feature_flag_evaluation(feature_name):
    """Decorator to log feature flag evaluations for observability."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            user_id = kwargs.get('user_id', 'unknown')
            attributes = kwargs.get('attributes', {})
            
            result = func(*args, **kwargs)
            
            logger.info(f'Feature flag evaluation', extra={
                'feature_name': feature_name,
                'user_id': user_id,
                'enabled': result,
                'attributes': attributes
            })
            
            return result
        return wrapper
    return decorator

@log_feature_flag_evaluation('new_checkout_flow')
def is_new_checkout_enabled(user_id, attributes):
    return evaluator.is_enabled('new_checkout_flow', user_id, attributes)
```

These logs flow to CloudWatch Logs, where you can analyze them with CloudWatch Insights:

```
fields @timestamp, feature_name, enabled, user_id
| stats count() as total_evaluations by feature_name, enabled
| filter total_evaluations > 100
```

You can also create custom metrics:

```python
import boto3

cloudwatch = boto3.client('cloudwatch')

def put_feature_flag_metric(feature_name, enabled):
    """Push feature flag evaluation to CloudWatch."""
    cloudwatch.put_metric_data(
        Namespace='FeatureFlags',
        MetricData=[
            {
                'MetricName': feature_name,
                'Value': 1 if enabled else 0,
                'Unit': 'None'
            }
        ]
    )
```

With metrics flowing into CloudWatch, you can create dashboards showing flag usage across your fleet and alarms that trigger if a flag unexpectedly disables for large percentages of traffic.

### Case Study: Rolling Out a Complex Feature

Let's walk through a realistic scenario: rolling out a new payment processing system that's faster and more reliable but needs careful validation before full release.

**Day 1: Initial Configuration**

You've built the new payment processor and thoroughly tested it. You're confident but cautious. You start with this configuration:

```json
{
  "features": {
    "new_payment_processor": {
      "enabled": true,
      "rollout": {
        "type": "percentage",
        "percentage": 2,
        "seed": "user_id"
      }
    }
  }
}
```

Only 2% of users see the new processor. You're primarily watching for system errors—payment processing failures, database connection issues, unexpected exceptions.

**Day 2: Metrics Look Good**

After 24 hours, error rates are identical between the old and new processors. No unexpected latency. You increase to 10%:

```json
{
  "features": {
    "new_payment_processor": {
      "enabled": true,
      "rollout": {
        "type": "percentage",
        "percentage": 10,
        "seed": "user_id"
      }
    }
  }
}
```

Now you watch not just for errors, but for business metrics: transaction success rates, average transaction amount, and customer support tickets related to payments.

**Day 4: Enterprise Customers Complain About Support**

Your largest enterprise customer contacts support frustrated about the payment processor change—they prefer the familiar experience. You don't want to disable the feature for everyone, but you can exclude them using attribute-based rollouts:

```json
{
  "features": {
    "new_payment_processor": {
      "enabled": true,
      "rollout": {
        "type": "attribute",
        "attributes": {
          "account_id": ["NOT_12345"]
        }
      }
    }
  }
}
```

Actually, this doesn't work because you can't easily express negation in AppConfig. Instead, you implement account whitelisting in your application:

```python
EXCLUDED_ACCOUNTS = {'12345'}

@app.route('/api/pay', methods=['POST'])
def process_payment():
    user_id = request.headers.get('X-User-ID')
    account_id = get_user_account(user_id)
    
    attributes = {
        'account_id': account_id
    }
    
    # Override feature flag for excluded accounts
    use_new_processor = (
        evaluator.is_enabled('new_payment_processor', user_id, attributes)
        and account_id not in EXCLUDED_ACCOUNTS
    )
    
    if use_new_processor:
        processor = new_payment_processor
    else:
        processor = legacy_payment_processor
    
    return processor.process(request.json)
```

**Day 7: Confident in New Processor**

After a week, all metrics show the new processor is superior—faster, more reliable, better customer experience. You roll out to 100%:

```json
{
  "features": {
    "new_payment_processor": {
      "enabled": true,
      "rollout": {
        "type": "percentage",
        "percentage": 100,
        "seed": "user_id"
      }
    }
  }
}
```

**Day 14: Legacy Processor Removed**

You've had two weeks of 100% traffic on the new processor. You now remove the legacy code path entirely, eliminating the feature flag from application logic:

```python
@app.route('/api/pay', methods=['POST'])
def process_payment():
    # New processor is now the only option
    return new_payment_processor.process(request.json)
```

And optionally clean up the AppConfig configuration since the feature flag is no longer needed:

```json
{
  "features": {
    "new_payment_processor": {
      "enabled": true,
      "rollout": {
        "type": "percentage",
        "percentage": 100,
        "seed": "user_id"
      }
    }
  }
}
```

Actually, leaving it in configuration indefinitely is reasonable. If you later need to experiment with alternative processors, the infrastructure is already in place. You're not paying for the feature flag; you're only paying for AppConfig API calls, which are minimal with agent-based caching.

### Best Practices and Common Pitfalls

As you implement feature flags with AppConfig, several patterns separate robust implementations from fragile ones.

**Use Consistent Hashing Seeds Carefully**. The seed determines which users fall into which percentile. `user_id` works well for most features, but consider the implications. If you use `user_id` and a user has multiple accounts, they might see different variants across accounts. If that's problematic, consider using the account ID as the seed instead.

**Always Default to False for Unknown Flags**. Your evaluator should return false if a flag doesn't exist or is misconfigured. This follows the principle of secure defaults—it's safer to disable a feature than to accidentally enable it due to configuration errors.

**Test Configuration Changes Locally Before Production Deployment**. Download your JSON configuration, test it locally with various user attributes, and verify the behavior matches expectations. A malformed configuration can disable all features, and testing catches this before production impact.

**Include Human-Readable Descriptions in Configuration**. As configurations grow complex, documenting why a rollout is configured a certain way becomes invaluable:

```json
{
  "features": {
    "new_checkout_flow": {
      "enabled": true,
      "description": "New single-page checkout; gradual rollout starting 2024-01-15; target 100% by 2024-01-22",
      "rollout": {
        "type": "percentage",
        "percentage": 50,
        "seed": "user_id"
      }
    }
  }
}
```

**Monitor Configuration Download Latency**. If the AppConfig Agent becomes slow to download configurations, your application startup time may increase. Track agent performance and investigate latency spikes.

**Use CloudWatch Events for Real-Time Change Notifications**. AppConfig can publish configuration changes to CloudWatch Events. You can subscribe to these events and trigger immediate refreshes of your feature flag cache, reducing propagation latency below the polling interval.

**Implement Circuit Breakers for Complex Rollouts**. If your attribute-based rollout logic becomes very complex with many conditions, wrap it in a circuit breaker that logs when evaluations fail:

```python
def is_enabled_safe(feature_name, user_id, attributes):
    try:
        return evaluator.is_enabled(feature_name, user_id, attributes)
    except Exception as e:
        logger.error(f'Feature flag evaluation failed: {e}')
        # Safe default
        return False
```

**Clean Up Disabled Features Regularly**. Over time, your configuration accumulates flags that have rolled out to 100% or been disabled. Periodically review and remove completed rollouts to keep the configuration maintainable and reduce cognitive load.

### Conclusion

Feature flags represent a fundamental shift in how teams deploy and release software. AppConfig makes this pattern accessible and manageable by providing a centralized service for configuration management, validation, and distribution to your applications via a lightweight, caching agent.

Whether you're implementing simple boolean flags, orchestrating complex percentage-based rollouts for gradual feature releases, or targeting specific user segments with attribute-based conditions, AppConfig's flexible architecture supports your needs. The combination of the AppConfig Agent's intelligent caching with your application's evaluation logic creates a system that's both performant and resilient.

The journey from idea to 100% rollout becomes more controlled and data-driven. You start with 2% of traffic, watch for errors, gradually increase as confidence grows, and make business decisions based on metrics rather than intuition. When issues arise, you can disable a feature globally in seconds without touching your deployment pipeline. This represents genuine operational leverage.

As you integrate feature flags deeper into your practice, you'll find they enable not just safer deployments but also experiments, A/B tests, and the ability to ship code without shipping features. Start simple with percentage-based rollouts, graduate to attribute-based targeting as your needs evolve, and build the observability to understand who's seeing what and why it matters.
