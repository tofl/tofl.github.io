---
title: "Parameter Store GetParametersByPath vs GetParameter: Choosing the Right API"
---

## Parameter Store GetParametersByPath vs GetParameter: Choosing the Right API

Configuration management is one of those invisible but critical components of modern applications. Whether you're managing database credentials, feature flags, or service endpoints, how you retrieve that configuration directly impacts your application's performance, cost, and maintainability. AWS Systems Manager Parameter Store offers two primary APIs for fetching parameters: `GetParameter` and `GetParametersByPath`. On the surface, they seem straightforward—one gets a single parameter, the other gets many. But the choice between them carries real implications for API efficiency, caching strategy, and overall system design.

In this article, we'll explore both APIs in depth, understand when to use each one, and examine practical patterns for optimizing configuration retrieval in your AWS applications.

### Understanding the Two APIs

Before diving into trade-offs, let's establish what each API actually does and how they differ at a fundamental level.

**GetParameter** is the simpler of the two. It retrieves a single parameter by its exact name. You call it with a parameter name—say `/myapp/prod/database-password`—and it returns that one parameter's value, metadata, and other attributes. Each parameter requires its own API call. This is straightforward and predictable: if you know exactly which parameters you need, you request them by name.

**GetParametersByPath** takes a different approach. Instead of naming a specific parameter, you provide a path prefix like `/myapp/prod/` and the API returns all parameters that begin with that prefix. This is powerful for bulk retrieval scenarios. If you have twenty configuration values under `/myapp/prod/`, a single `GetParametersByPath` call retrieves them all (respecting pagination limits). You can even add filters and recursive depth settings to fine-tune results.

The distinction matters because it shapes how you think about organizing and retrieving your configuration.

### API Call Efficiency and Cost Implications

Let's talk about the practical impact of these differences on your API usage.

Imagine you're building a microservice that needs ten configuration values at startup. With `GetParameter`, you're making ten API calls—one for each value. With `GetParametersByPath`, if all ten values sit under a common path prefix, you might retrieve them all in one or two calls (accounting for pagination). From a pure throughput perspective, `GetParametersByPath` can be significantly more efficient.

However, efficiency isn't always a linear function of API calls. Consider a scenario where you need just one or two specific parameters from a path containing fifty values. Calling `GetParameter` twice is cheaper and faster than calling `GetParametersByPath`, receiving fifty parameters, and discarding forty-eight of them. The network payload matters, as does the processing time on both client and server sides.

Parameter Store pricing is consumption-based. You pay per API call, regardless of whether you're fetching one parameter or fifty. This means that while `GetParametersByPath` might reduce the number of calls, it doesn't reduce costs if you're fetching parameters you don't need. The sweet spot for `GetParametersByPath` is when you genuinely need most or all of the parameters under a given path.

Additionally, Parameter Store has throttling limits. Standard tier supports 40 transactions per second, while high throughput tier supports 1,000 transactions per second. If your application makes rapid, repeated calls to `GetParameter` for different values, you might hit throttling. Batching these retrievals with `GetParametersByPath` naturally reduces contention.

### Caching Strategies Matter More Than You Might Think

Where these two APIs truly diverge is in how you cache their results—and caching is essential for any production application.

With `GetParameter`, your caching strategy is granular. You cache individual parameter values, keyed by parameter name. If your application needs `/myapp/prod/api-timeout` and `/myapp/prod/max-connections`, you cache each separately. When values change, you invalidate specific entries. This approach works well when parameters change at different frequencies or when different parts of your application consume different subsets of parameters.

With `GetParametersByPath`, you cache the entire result set—all parameters under a path. This is simpler in some ways: one cache entry, one TTL. But it's less granular. If only one parameter under `/myapp/prod/` changes, your cache logic must decide: do you invalidate the entire path result and refetch all fifty parameters, or do you accept stale data for the other forty-nine? The answer depends on your consistency requirements and how frequently changes occur.

Let's look at a practical example. Suppose you're using Lambda functions that need configuration at invocation time. Lambda's execution role likely has permissions to call Parameter Store, but every API call adds latency. For a function that processes thousands of requests per day, calling `GetParameter` separately for each value on every invocation is wasteful.

Here's a basic Python example using `GetParameter`:

```python
import boto3

ssm = boto3.client('ssm')

def get_single_parameter(name):
    response = ssm.get_parameter(Name=name, WithDecryption=True)
    return response['Parameter']['Value']

# Calling separately for each parameter
timeout = get_single_parameter('/myapp/prod/api-timeout')
max_conn = get_single_parameter('/myapp/prod/max-connections')
```

With `GetParametersByPath`, the same task looks like this:

```python
import boto3

ssm = boto3.client('ssm')

def get_parameters_by_path(path):
    paginator = ssm.get_paginator('get_parameters_by_path')
    pages = paginator.paginate(
        Path=path,
        Recursive=False,
        WithDecryption=True
    )
    
    parameters = {}
    for page in pages:
        for param in page['Parameters']:
            # Extract the parameter name without the path prefix
            name = param['Name'].split('/')[-1]
            parameters[name] = param['Value']
    
    return parameters

# Single call retrieves all parameters under the path
config = get_parameters_by_path('/myapp/prod/')
timeout = config.get('api-timeout')
max_conn = config.get('max-connections')
```

The second approach makes one (or a few) API call instead of two, but it also requires handling pagination and might fetch extra parameters you don't need.

When caching `GetParametersByPath` results in Lambda, many developers use a simple in-memory cache with a time-to-live. The challenge is deciding on an appropriate TTL. Too short and you're making frequent API calls; too long and you risk stale configuration. Some teams use event-driven invalidation (SNS notifications when parameters change) to refresh the cache immediately, but that adds complexity.

### Real-World Scenario: Building a Resilient Configuration Layer

Let's ground this in a realistic example. Suppose you're building a payment processing service with multiple environments and regions. Your configuration hierarchy looks like this:

```
/payment-service/prod/us-east-1/stripe-api-key
/payment-service/prod/us-east-1/stripe-webhook-secret
/payment-service/prod/us-east-1/timeout-ms
/payment-service/prod/us-east-1/retry-count
/payment-service/prod/us-west-2/stripe-api-key
/payment-service/prod/us-west-2/stripe-webhook-secret
...
```

If you use `GetParameter` to fetch configuration at service startup, you're making four separate API calls just for one region. As your configuration grows—adding feature flags, feature-specific settings, and environment-specific overrides—the call count explodes.

Using `GetParametersByPath` with the path `/payment-service/prod/us-east-1/`, you fetch all region-specific configuration in one call. You then cache the result. If that region's configuration contains fifteen parameters and changes only monthly, your cache with a one-hour TTL means you're making just a handful of API calls per service instance per day. That's dramatically more efficient than calling `GetParameter` repeatedly.

However, this strategy assumes your parameter organization supports hierarchical retrieval. If your parameters are scattered across different paths or follow an inconsistent naming convention, `GetParameter` becomes more practical despite the extra calls.

### AWS Lambda Powertools and Simplified Caching

AWS Lambda Powertools is an open-source library that abstracts away much of the caching complexity. Its Parameters utility layer provides automatic caching for both `GetParameter` and `GetParametersByPath` calls, including support for parameter change notifications.

Here's how you'd use it with `GetParametersByPath`:

```python
from aws_lambda_powertools.utilities.parameters import SSMProvider

provider = SSMProvider()

def lambda_handler(event, context):
    # Fetch all parameters under a path
    # Results are automatically cached with a 5-second default TTL
    config = provider.get_parameters_by_path(
        path='/myapp/prod/',
        recursive=False
    )
    
    timeout = config.get('api-timeout')
    max_conn = config.get('max-connections')
    
    return {'statusCode': 200}
```

The library handles pagination transparently and manages caching automatically. You can customize the TTL, and the cache is scoped to the Lambda function's memory, making it efficient across warm invocations.

For `GetParameter`, the usage is similarly clean:

```python
from aws_lambda_powertools.utilities.parameters import SSMProvider

provider = SSMProvider()

def lambda_handler(event, context):
    timeout = provider.get('/myapp/prod/api-timeout')
    max_conn = provider.get('/myapp/prod/max-connections')
    
    return {'statusCode': 200}
```

Both approaches cache results by default, reducing API calls on subsequent invocations of the same Lambda instance. This is crucial in serverless environments where cold starts and warm invocations have different cost and latency profiles.

### When to Use GetParameter

`GetParameter` is your best choice in several scenarios:

Use it when you need a specific set of parameters that are known at development time and don't change frequently. If your application always needs exactly `/myapp/prod/database-host`, `/myapp/prod/database-port`, and `/myapp/prod/database-user`, calling `GetParameter` three times is clear, explicit, and straightforward. There's no ambiguity about which parameters you're retrieving.

`GetParameter` is also preferable when your parameters are scattered across different paths with no common prefix. If you have `/database/host`, `/api/timeout`, and `/feature-flags/new-checkout`, there's no logical path prefix to use with `GetParametersByPath`. Calling `GetParameter` three times is simpler than trying to force a hierarchical structure.

Additionally, use `GetParameter` when you need to reference a single secret or sensitive value with high consistency requirements. For example, if your application decrypts a parameter value immediately after retrieval and that parameter is sensitive, calling `GetParameter` with decryption ensures you always get the current value. Caching a decrypted secret for an hour might introduce security concerns in your compliance model.

Finally, `GetParameter` makes sense when different parts of your application need different parameters. If one microservice needs config A and another needs config B, `GetParameter` allows them to fetch only what they need without pulling in irrelevant configuration.

### When to Use GetParametersByPath

`GetParametersByPath` shines when you have a well-organized, hierarchical parameter structure and you regularly need multiple parameters together.

Use it for bulk configuration loading at service startup. When your application initializes, it often needs many parameters simultaneously. A single `GetParametersByPath` call is much more efficient than N individual `GetParameter` calls.

`GetParametersByPath` is also excellent for multi-tenancy scenarios. If each tenant has configuration under `/tenants/{tenant-id}/`, you can load all tenant-specific parameters in one call. This scales well as the number of parameters per tenant grows.

Use `GetParametersByPath` when building configuration dashboards or tools that need to display all parameters in a namespace. It's far more practical than hardcoding a list of parameter names and calling `GetParameter` for each.

Finally, `GetParametersByPath` is valuable when you're implementing environment-specific configuration that follows a consistent structure. All production parameters under `/myapp/prod/`, all staging parameters under `/myapp/staging/`. A single call retrieves everything for that environment, which you can cache and use throughout the application.

### Combining Both APIs Strategically

In real-world applications, you often use both APIs strategically. You might use `GetParametersByPath` at application startup to load the bulk of your configuration, caching the result. Then, for runtime changes or specific override scenarios, you use `GetParameter` to fetch individual values without refetching the entire path.

For example, a feature flag service might do this:

```python
from aws_lambda_powertools.utilities.parameters import SSMProvider

provider = SSMProvider()

def get_feature_flag(flag_name):
    # For frequently changing flags, fetch individually
    return provider.get(f'/feature-flags/{flag_name}')

def load_config():
    # For stable configuration, fetch the entire path at startup
    return provider.get_parameters_by_path('/myapp/prod/')

config = load_config()  # Cache this
feature_enabled = get_feature_flag('new-checkout')  # Check dynamically
```

This hybrid approach balances efficiency with flexibility. Stable configuration is batched; dynamic values are fetched individually.

### Performance Considerations and Throttling

Both APIs are subject to Parameter Store rate limits. Understanding these limits helps you choose appropriately.

The standard tier of Parameter Store allows 40 transactions per second. If your application makes ten `GetParameter` calls per request and handles a hundred requests per second, you're attempting 1,000 transactions per second—well above the limit. You'd experience throttling and degraded performance.

Switching to `GetParametersByPath` and caching the results would reduce this to perhaps ten transactions per second (batches of requests hitting the cache), comfortably under the limit.

The high-throughput tier increases this to 1,000 transactions per second, but it costs more. Before upgrading, consider whether caching and batching (using `GetParametersByPath`) can solve the problem more cost-effectively.

Additionally, consider the Lambda context. Lambda functions have limited execution time (15 minutes maximum). Every API call adds latency. In latency-sensitive workloads like API request processing, minimizing API calls is critical. A function that calls `GetParameter` five times might add 500ms to a request's latency (assuming 100ms per call). Batching with `GetParametersByPath` and caching could reduce this to a single request or eliminate it entirely for warm function invocations.

### Error Handling and Resilience

Both APIs can fail, and your strategy should account for this.

`GetParameter` can fail if a single parameter doesn't exist, if you lack permissions, or if the service is throttled. Your code needs to handle `ParameterNotFound` exceptions and implement retry logic with exponential backoff.

`GetParametersByPath` can fail similarly, but the consequences are different. If `GetParametersByPath` fails, you lose access to all parameters under that path, not just one. Your caching and fallback strategy becomes even more important. Consider caching successful results aggressively and gracefully degrading with stale data if the API call fails.

Here's a resilient pattern:

```python
import boto3
from botocore.exceptions import ClientError
import time

ssm = boto3.client('ssm')

class ConfigCache:
    def __init__(self):
        self.cache = {}
        self.last_update = {}
    
    def get_parameters_by_path(self, path, max_age=3600):
        now = time.time()
        
        # Return cached data if it's still fresh
        if path in self.cache and (now - self.last_update.get(path, 0)) < max_age:
            return self.cache[path]
        
        # Try to fetch fresh data
        try:
            paginator = ssm.get_paginator('get_parameters_by_path')
            pages = paginator.paginate(Path=path, Recursive=False, WithDecryption=True)
            
            parameters = {}
            for page in pages:
                for param in page['Parameters']:
                    name = param['Name'].split('/')[-1]
                    parameters[name] = param['Value']
            
            # Cache the result
            self.cache[path] = parameters
            self.last_update[path] = now
            return parameters
        
        except ClientError as e:
            # If fetch fails, return stale cache if available
            if path in self.cache:
                return self.cache[path]
            # Otherwise re-raise the exception
            raise

cache = ConfigCache()
config = cache.get_parameters_by_path('/myapp/prod/')
```

This approach ensures that even if Parameter Store becomes temporarily unavailable, your application continues operating with stale configuration rather than failing completely.

### Pagination and Large Result Sets

`GetParametersByPath` results are paginated. By default, a single response includes up to ten parameters. If you have a hundred parameters under a path, you'll get ten separate page results. The pagination is typically handled transparently by the paginator, but it's worth understanding.

Large result sets have implications for both performance and caching. Fetching a hundred parameters in ten paginated calls takes longer than fetching ten parameters in one call. If you're caching the entire result set, you're holding more data in memory. These are usually acceptable trade-offs, but they matter in memory-constrained environments like Lambda.

One optimization: if you know you only need a subset of parameters, consider using path filtering or recursive options. The `Recursive` parameter controls whether the call returns parameters in nested subdirectories. Setting `Recursive=False` when you don't need nested values reduces the result set size.

### Parameter Naming and Organization

How you organize your parameters directly impacts which API makes sense. If you follow a hierarchical naming convention—`/app/environment/component/setting`—you unlock the power of `GetParametersByPath`. You can efficiently retrieve all parameters for an environment, a component, or even a specific setting type.

Conversely, if your parameters are named flat without hierarchical structure—`myapp-database-host`, `myapp-api-timeout`, `myapp-feature-flag-checkout`—`GetParameter` becomes more practical. There's no logical prefix to retrieve them with `GetParametersByPath`.

The best practice is to design your naming structure with `GetParametersByPath` in mind. A clear hierarchy makes configuration management and automation much easier.

### Testing and Local Development

When developing and testing, you'll want to mock Parameter Store calls. Both `GetParameter` and `GetParametersByPath` can be mocked using libraries like `unittest.mock` or `moto`, which provides AWS service mocking.

Here's an example using `moto`:

```python
from moto import mock_ssm
import boto3

@mock_ssm
def test_get_parameters():
    ssm = boto3.client('ssm', region_name='us-east-1')
    
    # Set up test parameters
    ssm.put_parameter(Name='/myapp/test/timeout', Value='30', Type='String')
    ssm.put_parameter(Name='/myapp/test/max-conn', Value='100', Type='String')
    
    # Test GetParametersByPath
    response = ssm.get_parameters_by_path(Path='/myapp/test/')
    assert len(response['Parameters']) == 2
    
    # Test GetParameter
    response = ssm.get_parameter(Name='/myapp/test/timeout')
    assert response['Parameter']['Value'] == '30'
```

Mocking allows you to test your configuration retrieval logic without hitting actual Parameter Store, making tests faster and more reliable.

### Conclusion

Choosing between `GetParameter` and `GetParametersByPath` isn't a matter of one being universally superior; it's about understanding your configuration structure, access patterns, and optimization priorities. `GetParameter` excels when you need specific known parameters, especially if they're scattered across different paths. `GetParametersByPath` shines when you have organized hierarchical configuration that you need to retrieve in bulk.

In practice, most production applications use both. They implement efficient caching—whether through Lambda Powertools or custom logic—to minimize API calls regardless of which retrieval method they use. They design parameter naming hierarchies that support bulk retrieval, and they implement resilience patterns to gracefully handle API failures.

The key insight is that configuration retrieval is a performance-critical operation. Optimizing it through thoughtful API choice, intelligent caching, and resilient error handling contributes meaningfully to your application's overall efficiency, cost, and reliability. Start by evaluating your parameter structure and access patterns, then choose the API that minimizes both API calls and operational complexity for your specific use case.
