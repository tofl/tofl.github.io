---
title: "Caching SSM Parameters and Secrets in Lambda with the Parameters and Secrets Extension"
---

## Caching SSM Parameters and Secrets in Lambda with the Parameters and Secrets Extension

Every Lambda developer has faced a familiar dilemma: your function needs configuration values, API keys, or database credentials stored securely in AWS Systems Manager Parameter Store or Secrets Manager. You could fetch them fresh on every invocation for guaranteed freshness, but that adds latency and costs. Or you could hard-code them, which is a security nightmare. What if there were a middle ground—a way to get the performance benefits of caching without sacrificing security or adding complexity to your application code?

That's exactly what the AWS Parameters and Secrets Lambda Extension solves. It's a purpose-built Lambda layer that runs alongside your function and provides a local HTTP cache for your parameters and secrets. This article walks you through how it works, how to set it up, and the practical considerations that make it such a valuable tool in a developer's AWS toolkit.

### Understanding the Parameters and Secrets Extension

The Parameters and Secrets Lambda Extension is a lightweight daemon that runs in your Lambda execution environment as a separate process. It acts as an intelligent intermediary between your application code and AWS Systems Manager Parameter Store or Secrets Manager. Instead of making API calls directly to these services every time your function needs a value, your code makes simple HTTP requests to a local endpoint on `localhost:2773` where the extension is listening.

The real magic happens behind the scenes: the extension maintains an in-memory cache of the parameters and secrets you've requested, respecting configurable time-to-live (TTL) settings and maximum cache size limits. This approach gives you significant control over the freshness-versus-performance trade-off. You're no longer choosing between "always fresh" (and slow) or "hard-coded" (and unsafe); instead, you're choosing exactly how stale your data can be.

Think of it like a local coffee shop near your office versus traveling downtown to the original roastery every morning. You get your coffee faster and cheaper, and it's still fresh enough for your purposes. Similarly, your Lambda function gets its configuration and secrets faster while keeping them reasonably current.

### Why This Matters: The Cost and Performance Calculus

Before diving into implementation, let's talk about why this extension exists. Every call to Parameter Store or Secrets Manager costs money and adds latency. For a high-volume Lambda application, these costs compound quickly. If a function invokes 100 times per minute and each invocation fetches five parameters, you're looking at 500 API calls per minute, or over 700,000 per day. Each of those calls incurs a small cost and introduces round-trip latency.

The extension eliminates this waste through intelligent caching. By storing frequently-accessed values locally, you dramatically reduce the number of upstream API calls. For many workloads, the difference between caching with a 5-minute TTL and fetching on every invocation is the difference between a handful of daily API calls and thousands.

Beyond cost, there's the latency argument. A local HTTP call to `localhost:2773` is orders of magnitude faster than making a network request to the Parameter Store API endpoint. For latency-sensitive applications—especially those that need to call multiple parameters or secrets—this can mean the difference between a 200ms function execution and a 50ms one.

### Installing the Extension as a Lambda Layer

Before your code can use the extension, you need to add it to your Lambda function as a layer. AWS provides pre-built extension layers for each region and runtime, which simplifies deployment significantly.

The extension is available as an ARN in each region. For example, in us-east-1, the ARN follows the pattern: `arn:aws:lambda:us-east-1:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:11`. The number at the end represents the version; AWS regularly updates this with bug fixes and improvements.

To add the layer using the AWS Management Console, navigate to your Lambda function, scroll to the Layers section at the bottom of the Configuration tab, and select "Add a layer." Choose "Specify an ARN" and paste the appropriate ARN for your region. If you're using Infrastructure as Code, adding the layer is equally straightforward in CloudFormation, Terraform, or the AWS CDK.

Here's how you'd add it using the AWS CLI:

```bash
aws lambda update-function-configuration \
  --function-name my-function \
  --layers arn:aws:lambda:us-east-1:177933569100:layer:AWS-Parameters-and-Secrets-Lambda-Extension:11
```

Once the layer is attached, the extension process starts automatically when your function initializes. You don't need to install anything or write initialization code; it's ready to use immediately.

### Configuring Cache Behavior with Environment Variables

The extension's behavior is controlled through environment variables set on your Lambda function. These settings allow you to tune caching to match your specific security and performance requirements.

The primary configuration options are `PARAMETERS_SECRETS_EXTENSION_CACHE_ENABLED`, `PARAMETERS_SECRETS_EXTENSION_MAX_CACHE_SIZE`, and `PARAMETERS_SECRETS_EXTENSION_TTL_SECS`. Let's explore each.

By default, caching is enabled, but you can explicitly set `PARAMETERS_SECRETS_EXTENSION_CACHE_ENABLED` to `false` if you need to disable it for a particular function. This is useful during development or if you're testing behavior without caching.

The `PARAMETERS_SECRETS_EXTENSION_MAX_CACHE_SIZE` variable controls how much data the extension can store in memory. The default is 1000 MB, which is generous for most use cases, but you can reduce it if you want to be conservative with memory usage or increase it if you're caching a large number of secrets.

The `PARAMETERS_SECRETS_EXTENSION_TTL_SECS` variable sets the time-to-live for cached items in seconds. The default is 3600 (one hour), meaning each parameter or secret remains in cache for up to an hour before being refreshed. If you need fresher data, you can reduce this to 300 seconds (5 minutes) or lower. Conversely, if your data changes infrequently and you want to minimize API calls, you can increase it to several hours.

Here's an example of setting these variables via the CLI:

```bash
aws lambda update-function-configuration \
  --function-name my-function \
  --environment Variables="{PARAMETERS_SECRETS_EXTENSION_TTL_SECS=300,PARAMETERS_SECRETS_EXTENSION_MAX_CACHE_SIZE=500}"
```

A practical tip: start with the defaults and adjust based on your specific needs. If you notice that configuration changes aren't picking up quickly enough, lower the TTL. If you're concerned about cache memory usage, reduce the max cache size. Most applications find that a 5-minute to 1-hour TTL provides an excellent balance.

### Calling the Extension from Your Application Code

Using the extension is refreshingly simple. Instead of calling `ssm_client.get_parameter()` or `secrets_client.get_secret_value()`, you make an HTTP GET request to a local endpoint.

For parameters in Parameter Store, the URL format is:

```
http://localhost:2773/parameters/get?name=parameter-name
```

For secrets in Secrets Manager, it's:

```
http://localhost:2773/secrets/get?name=secret-name
```

Here's a practical example in Python using the `requests` library:

```python
import requests
import json

def get_parameter(parameter_name):
    response = requests.get(
        f"http://localhost:2773/parameters/get?name={parameter_name}"
    )
    response.raise_for_status()
    return response.json()['Parameter']['Value']

def get_secret(secret_name):
    response = requests.get(
        f"http://localhost:2773/secrets/get?name={secret_name}"
    )
    response.raise_for_status()
    return response.json()['SecretString']

def lambda_handler(event, context):
    db_password = get_secret('prod/db/password')
    api_endpoint = get_parameter('/myapp/api-endpoint')
    
    # Use db_password and api_endpoint...
    return {'statusCode': 200}
```

If you're using Node.js, the approach is nearly identical:

```javascript
const https = require('http');

async function getParameter(parameterName) {
    return new Promise((resolve, reject) => {
        https.get(`http://localhost:2773/parameters/get?name=${parameterName}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).Parameter.Value);
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

async function getSecret(secretName) {
    return new Promise((resolve, reject) => {
        https.get(`http://localhost:2773/secrets/get?name=${secretName}`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data).SecretString);
                } catch (err) {
                    reject(err);
                }
            });
        }).on('error', reject);
    });
}

exports.handler = async (event) => {
    const dbPassword = await getSecret('prod/db/password');
    const apiEndpoint = await getParameter('/myapp/api-endpoint');
    
    // Use dbPassword and apiEndpoint...
    return { statusCode: 200 };
};
```

Notice that the response format mirrors what you'd get from the AWS SDK directly. For parameters, you're working with a `Parameter` object containing a `Value` field. For secrets, you get a `SecretString` field. This familiar structure means minimal changes to existing code.

### IAM Permissions: Granting Your Function Access

Here's something that catches many developers off guard: the extension doesn't somehow bypass IAM permissions. Your Lambda function's execution role still needs appropriate permissions to access the parameters and secrets you're requesting.

If your function is calling `GetParameter` or `GetParameters` for System Manager parameters, your role needs the `ssm:GetParameter` and/or `ssm:GetParameters` actions. For Secrets Manager, you need `secretsmanager:GetSecretValue`.

Here's a minimal but practical IAM policy:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameter",
                "ssm:GetParameters"
            ],
            "Resource": "arn:aws:ssm:us-east-1:123456789012:parameter/myapp/*"
        },
        {
            "Effect": "Allow",
            "Action": "secretsmanager:GetSecretValue",
            "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:myapp/*"
        }
    ]
}
```

This policy grants access to parameters and secrets matching the `/myapp/*` path prefix. Following the principle of least privilege, you should always scope your permissions as narrowly as practical. If only a specific secret is needed, grant access only to that secret's ARN rather than a wildcard.

One important note: the extension caches credentials and makes requests on behalf of your function. If the underlying IAM permissions are insufficient, the extension will encounter an error when trying to fetch a value. The first request for a parameter or secret will fail if permissions are missing, and this failure will propagate to your code. This means your permission configuration must be correct before deploying—there's no silent fallback or degradation.

### The Trade-Off: Balancing Freshness and Performance

The core benefit of the extension is that it lets you choose where you sit on the spectrum between perfect freshness and maximum performance. Understanding this trade-off is essential for using the extension effectively.

With no caching (TTL of 0 or caching disabled), every invocation fetches the latest value directly from Parameter Store or Secrets Manager. Your configuration is always current, but you're paying for every single API call, and you're introducing latency on every invocation. This approach makes sense for truly sensitive data that changes frequently and unpredictably, but it's expensive and slow.

With aggressive caching (TTL of 3600 seconds or higher), you minimize API calls and maximize performance. Your function runs fast and your API costs drop dramatically. The trade-off is that parameter or secret updates may take up to an hour to reach your Lambda functions. For most configuration data—database connection strings, feature flags, API endpoints—a 5-minute to 1-hour delay is entirely acceptable. For truly dynamic data or sensitive security credentials that need to be rotated frequently, you'd want a shorter TTL.

A common pattern is tiered caching: critical secrets like database credentials might have a 5-minute TTL, while less sensitive configuration like API endpoints might use a 1-hour TTL. You configure this by calling the extension multiple times with different parameters and controlling their cache behavior through your application logic or by adjusting the global TTL and handling specific cases in code.

In practice, most organizations find that a 5 to 15-minute TTL provides excellent protection against staleness while delivering substantial cost savings and performance improvements. Rotations and updates still propagate within a reasonable timeframe, and the vast majority of your API calls are eliminated.

### Practical Considerations and Common Patterns

When you're integrating the extension into your Lambda functions, a few practical patterns emerge that experienced developers use.

First, consider wrapping your parameter and secret retrieval in helper functions, as shown earlier. This abstraction means that if you ever need to change how you fetch values—perhaps to handle errors differently, add logging, or switch caching strategies—you only need to update one place in your code.

Second, remember that the extension runs in the Lambda execution environment alongside your function. It consumes a small amount of memory and CPU, but this overhead is negligible for most workloads. The tradeoff of a few MB of memory consumption for eliminating hundreds of API calls per day is almost always worthwhile.

Third, be aware of cold starts. When your Lambda function cold-starts, the extension process also initializes. It doesn't have any cached values initially, so the first request for a parameter or secret on a cold start will require a fresh API call. This is expected and unavoidable; the cache only helps across warm invocations. That said, subsequent invocations in the same warm container will benefit from caching, and for most high-traffic functions, warm invocations vastly outnumber cold ones.

Fourth, consider error handling. The extension is generally reliable, but network issues or permission problems could cause requests to fail. Wrapping your parameter retrieval in try-catch blocks and implementing reasonable fallback behavior—such as retrying or using a default value—makes your function more resilient.

Here's a more robust version of the earlier example:

```python
import requests
import json
from functools import lru_cache

@lru_cache(maxsize=128)
def get_parameter(parameter_name, max_retries=2):
    for attempt in range(max_retries):
        try:
            response = requests.get(
                f"http://localhost:2773/parameters/get?name={parameter_name}",
                timeout=2
            )
            response.raise_for_status()
            return response.json()['Parameter']['Value']
        except requests.RequestException as e:
            if attempt == max_retries - 1:
                raise
            continue
    
def get_secret(secret_name, max_retries=2):
    for attempt in range(max_retries):
        try:
            response = requests.get(
                f"http://localhost:2773/secrets/get?name={secret_name}",
                timeout=2
            )
            response.raise_for_status()
            return response.json()['SecretString']
        except requests.RequestException as e:
            if attempt == max_retries - 1:
                raise
            continue

def lambda_handler(event, context):
    try:
        db_password = get_secret('prod/db/password')
        api_endpoint = get_parameter('/myapp/api-endpoint')
    except Exception as e:
        print(f"Failed to retrieve configuration: {e}")
        # Implement appropriate fallback behavior
        raise
    
    # Use db_password and api_endpoint...
    return {'statusCode': 200}
```

Notice the added timeout parameter and retry logic. These defensive measures help your function handle transient issues gracefully.

### When to Use and When to Avoid the Extension

The extension shines in certain scenarios and is less appropriate in others. It's ideal when you have high-volume Lambda functions that invoke frequently and need to access the same parameters or secrets repeatedly. E-commerce platforms handling thousands of orders per minute, SaaS applications with multi-tenant configurations, and data processing pipelines that transform information in batches all benefit enormously.

It's also excellent when you have functions that need to access many parameters or secrets. Instead of making 5, 10, or 20 individual API calls in sequence, you make 5 or 10 local HTTP calls to the cache, and the extension batches upstream requests intelligently.

However, there are scenarios where the extension adds complexity without benefit. If your function runs infrequently and never needs the same parameter twice, the caching provides no advantage. Functions that handle extremely latency-sensitive operations and can't afford even the minimal overhead of an extra HTTP call might want to stick with direct SDK calls or hard-coded values (though this is rare).

Similarly, if your parameter or secret changes frequently and unpredictably, and you absolutely need the latest value on every invocation, disabling the cache might be necessary—though consider whether that's truly a requirement or just a preference.

### Monitoring and Troubleshooting

When you implement the extension, it's helpful to understand how to monitor its behavior and troubleshoot issues.

The extension logs to CloudWatch Logs in the same stream as your Lambda function. If you enable DEBUG-level logging by setting the `AWS_LAMBDA_LOG_LEVEL` environment variable to `DEBUG`, the extension outputs detailed information about cache hits, misses, and API calls. This visibility is invaluable when you're tuning your caching strategy.

If a request to the extension fails, you'll see a connection error or HTTP error in your function's output. Common causes include the extension not being properly attached as a layer, IAM permissions being insufficient, or the parameter or secret name being incorrect. The error messages are usually descriptive enough to point you toward the solution.

You can also verify the extension is running by checking the Lambda function's layer configuration in the console or by making a request to `http://localhost:2773` from within your function code. If the extension is running, you'll get a response; if it's not, the request will fail with a connection error.

### Conclusion

The AWS Parameters and Secrets Lambda Extension represents a thoughtful solution to a real problem that every Lambda developer faces: how to keep configuration fresh and secure while maintaining performance and controlling costs. By providing a local cache with configurable freshness guarantees, it eliminates the false choice between always fetching (expensive, slow) and never fetching (dangerous, stale).

Implementing the extension is straightforward—add a layer, set a few environment variables, and update your code to make HTTP calls instead of SDK calls. The investment is minimal, but the returns come quickly in the form of faster function execution, lower API costs, and code that's simpler to reason about.

As you incorporate the extension into your Lambda functions, remember that the key to effective use is tuning the TTL to match your actual requirements. For most applications, a 5 to 15-minute cache window strikes an excellent balance. Start there, monitor your costs and freshness requirements, and adjust as needed. With the extension in place, you've solved one of the most common performance and cost optimization challenges in serverless architecture.
