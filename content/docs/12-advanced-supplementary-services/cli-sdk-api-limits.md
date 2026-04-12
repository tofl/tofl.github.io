---
title: "38. AWS CLI, SDK & API Limits"
type: docs
weight: 1
---

## AWS CLI, SDK & API Limits

When you move beyond the AWS Console, you interact with AWS programmatically — through the CLI for scripts and automation, through SDKs for application code, and directly via HTTP APIs when you need full control. Understanding how these tools work, how credentials are resolved, and how to handle the rate limits AWS enforces on every API call is essential for building reliable, production-grade applications.

### AWS CLI

The AWS CLI is a unified command-line tool that lets you manage AWS services from your terminal [🔗](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-getting-started.html). After installing it, you configure it with `aws configure`, which writes credentials and a default region to `~/.aws/credentials` and `~/.aws/config`.

**Named profiles** let you manage multiple accounts or roles without overwriting your defaults [🔗](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html). You create them with `aws configure --profile <name>` and invoke them with the `--profile` flag or the `AWS_PROFILE` environment variable:

```bash
aws s3 ls --profile production
```

This is the standard pattern when working across dev, staging, and production accounts from the same machine.

**CLI pagination** becomes important when a command returns more results than a single API response can carry. Two flags control this:

- `--page-size` controls how many items are fetched *per API call* (affects network traffic and timeout risk, not output size).
- `--max-items` caps the total number of items returned to your terminal.

```bash
aws dynamodb scan --table-name Orders --page-size 100 --max-items 500
```

If there are more results beyond `--max-items`, the CLI returns a `NextToken` you can pass with `--starting-token` to continue [🔗](https://docs.aws.amazon.com/cli/latest/userguide/cli-usage-pagination.html). This is especially relevant for exam questions about efficiently handling large result sets without overwhelming the CLI or hitting timeouts.

### AWS SDKs

AWS SDKs are available for most major languages — Python (boto3), JavaScript/TypeScript, Java, Go, .NET, Ruby, PHP, and more [🔗](https://aws.amazon.com/developer/tools/). They wrap the raw HTTP API calls, handle request signing (SigV4), and surface service responses as native language objects. In application code, you will almost always use an SDK rather than crafting raw API requests.

**The credential chain** is the ordered sequence the SDK follows to find credentials automatically [🔗](https://docs.aws.amazon.com/sdkref/latest/guide/standardized-credentials.html). It resolves credentials in this priority order:

1. Explicit code-level credentials (not recommended — avoid hardcoding)
2. Environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`)
3. AWS shared credentials file (`~/.aws/credentials`)
4. AWS config file (`~/.aws/config`)
5. Container credentials (ECS task role)
6. EC2 instance profile / ECS task role via the metadata service (IMDSv2)

In production on AWS compute, you should always rely on the last option — attach an IAM role to your Lambda function, EC2 instance, or ECS task and let the SDK pick up temporary credentials automatically. This eliminates the need to manage or rotate long-term keys.

**Environment variables** are a common way to inject credentials in CI/CD pipelines and containerized environments [🔗](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-envvars.html):

```bash
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
export AWS_DEFAULT_REGION=eu-west-1
```

Environment variables take precedence over the credentials file, making them suitable for short-lived pipeline contexts.

### API Rate Limits and Exponential Backoff with Jitter

Every AWS API has throttling limits — a ceiling on how many requests a service will accept per second per account or per region. When you exceed them, the API returns a `ThrottlingException` or an HTTP `429 Too Many Requests`. This is not an error in the traditional sense; it is a signal to slow down and retry.

**Exponential backoff** is the standard retry strategy: after each failed attempt, you wait for an exponentially increasing interval before retrying — 1s, 2s, 4s, 8s, and so on, up to a maximum cap.

**Jitter** adds a random offset to each wait interval. Without jitter, all clients that hit a throttle at the same moment will retry simultaneously, causing a *retry storm* that re-throttles the API immediately. Jitter spreads retries across time:

```python
import random, time

def backoff_with_jitter(attempt, base=0.5, cap=20):
    return min(cap, base * (2 ** attempt)) * random.random()

for attempt in range(5):
    try:
        response = client.put_item(...)
        break
    except client.exceptions.ProvisionedThroughputExceededException:
        time.sleep(backoff_with_jitter(attempt))
```

AWS SDKs include built-in retry logic with exponential backoff for retryable errors. You can tune the maximum number of retries via SDK configuration [🔗](https://docs.aws.amazon.com/general/latest/gr/api-retries.html), but understanding the underlying pattern is essential — particularly for services like DynamoDB, API Gateway, and SQS that are frequently throttled under load.

Service-specific examples worth knowing:
- **DynamoDB**: throws `ProvisionedThroughputExceededException` when read/write capacity is exhausted on provisioned tables.
- **S3**: `SlowDown` (503) when request rate exceeds per-prefix limits; mitigated by using randomized key prefixes.
- **Lambda**: `TooManyRequestsException` when concurrency limits are hit.
- **API Gateway**: 429 responses when usage plan throttles or account-level limits are reached.

### Service Quotas and Limit Increases

AWS imposes both *soft limits* (adjustable via a support request) and *hard limits* (fixed by AWS architecture). The **Service Quotas** console [🔗](https://docs.aws.amazon.com/servicequotas/latest/userguide/intro.html) gives you a central place to view current limits across all services and submit increase requests without opening a support ticket manually. For exam scenarios, remember that hitting a limit is not necessarily a code problem — sometimes the correct answer is to request a quota increase.

{{< qcm >}}
[
{
"question": "A developer runs the following CLI command and receives only 500 results, but suspects there are more. What should they do to retrieve the next page of results?\n\n`aws dynamodb scan --table-name Orders --page-size 100 --max-items 500`",
"answers": [
{
"answer": "Use the `NextToken` returned in the response with the `--starting-token` flag.",
"isCorrect": true,
"explanation": "When `--max-items` caps the output, the CLI returns a `NextToken`. Passing it via `--starting-token` in a subsequent call continues pagination from where the previous call left off."
},
{
"answer": "Increase `--page-size` to 500 to get all results in one call.",
"isCorrect": false,
"explanation": "`--page-size` controls how many items are fetched per underlying API call, not the total output. It does not bypass the `--max-items` cap."
},
{
"answer": "Remove `--max-items` and re-run the command.",
"isCorrect": false,
"explanation": "While removing `--max-items` would return all results in one terminal output, the correct pattern for iterating paginated results programmatically is to use `--starting-token` with the returned `NextToken`."
},
{
"answer": "Set `--page-size` to 1000 to force a single API call.",
"isCorrect": false,
"explanation": "`--page-size` affects network batch size per API call, not the total number of results returned. It has no effect on pagination continuation."
}
]
},
{
"question": "What is the correct distinction between `--page-size` and `--max-items` in the AWS CLI?",
"answers": [
{
"answer": "`--page-size` controls how many items are fetched per API call; `--max-items` caps the total items returned to the terminal.",
"isCorrect": true,
"explanation": "`--page-size` affects each underlying HTTP request (useful to avoid timeouts on large tables), while `--max-items` limits total output seen by the user — they are independent of each other."
},
{
"answer": "`--max-items` controls how many items are fetched per API call; `--page-size` caps the total items returned.",
"isCorrect": false,
"explanation": "This is reversed. `--page-size` is per-API-call granularity; `--max-items` is the total output limit."
},
{
"answer": "Both flags serve the same purpose and are interchangeable.",
"isCorrect": false,
"explanation": "They are not interchangeable. They control different aspects of pagination: network batch size vs. total output cap."
},
{
"answer": "`--page-size` limits the total output and `--max-items` is used only for DynamoDB scans.",
"isCorrect": false,
"explanation": "Neither statement is correct. `--page-size` is a per-call setting and both flags apply to many CLI commands, not just DynamoDB."
}
]
},
{
"question": "A developer configures multiple AWS CLI profiles on their laptop to work with dev and production accounts. Which of the following commands correctly uses the `production` profile?",
"answers": [
{
"answer": "`aws s3 ls --profile production`",
"isCorrect": true,
"explanation": "The `--profile` flag selects a named profile defined in `~/.aws/credentials` or `~/.aws/config`, allowing you to target a specific account without overwriting your default credentials."
},
{
"answer": "`aws s3 ls --account production`",
"isCorrect": false,
"explanation": "`--account` is not a valid AWS CLI flag. The correct flag for selecting a named profile is `--profile`."
},
{
"answer": "`AWS_PROFILE=production aws s3 ls`",
"isCorrect": true,
"explanation": "Setting the `AWS_PROFILE` environment variable is an equivalent way to specify a named profile. Both this and `--profile` are valid approaches."
},
{
"answer": "`aws s3 ls --region production`",
"isCorrect": false,
"explanation": "`--region` expects an AWS region identifier (e.g., `us-east-1`), not a profile name. This would result in an error."
}
]
},
{
"question": "An application running on an EC2 instance needs to call DynamoDB. What is the recommended approach to provide credentials to the AWS SDK?",
"answers": [
{
"answer": "Attach an IAM role to the EC2 instance and let the SDK resolve credentials automatically via the instance metadata service.",
"isCorrect": true,
"explanation": "This is the best practice. The SDK's credential chain automatically picks up temporary credentials from the EC2 instance profile via IMDSv2, eliminating the need to manage or rotate long-term keys."
},
{
"answer": "Hardcode the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` directly in the application source code.",
"isCorrect": false,
"explanation": "Hardcoding credentials is explicitly discouraged. It is a security risk and makes key rotation difficult. The SDK credential chain exists precisely to avoid this."
},
{
"answer": "Store credentials in `~/.aws/credentials` on the EC2 instance.",
"isCorrect": false,
"explanation": "While technically functional, storing long-term credentials on an EC2 instance is a security anti-pattern. Using an IAM instance role is far preferred as credentials are temporary and automatically rotated."
},
{
"answer": "Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` as environment variables on the EC2 instance.",
"isCorrect": false,
"explanation": "While environment variables work and take precedence over the credentials file, they still involve managing long-term keys. An IAM instance role is the correct production approach."
}
]
},
{
"question": "In what order does the AWS SDK resolve credentials? (Select the correct ordered sequence)",
"answers": [
{
"answer": "Explicit code credentials → Environment variables → Credentials file → Config file → Container credentials → EC2 instance profile",
"isCorrect": true,
"explanation": "This is the exact priority order defined by the AWS SDK credential provider chain. Each source is checked in order, and the first one that provides valid credentials wins."
},
{
"answer": "EC2 instance profile → Environment variables → Credentials file → Explicit code credentials",
"isCorrect": false,
"explanation": "This order is reversed. Explicit code credentials have the highest priority (though they should be avoided), and the instance profile is checked last as a fallback."
},
{
"answer": "Environment variables → Credentials file → Explicit code credentials → EC2 instance profile",
"isCorrect": false,
"explanation": "Explicit code-level credentials always take priority over environment variables, which themselves take priority over the credentials file."
},
{
"answer": "Credentials file → Config file → Environment variables → EC2 instance profile",
"isCorrect": false,
"explanation": "Environment variables take precedence over both the credentials file and config file in the SDK credential chain."
}
]
},
{
"question": "A CI/CD pipeline needs to authenticate to AWS to deploy a Lambda function. Which credential method is most appropriate for this short-lived pipeline context?",
"answers": [
{
"answer": "Inject credentials via environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`) in the pipeline configuration.",
"isCorrect": true,
"explanation": "Environment variables are the standard pattern for CI/CD pipelines. They take precedence over credentials files, are not persisted to disk, and can be rotated centrally in the pipeline's secret store."
},
{
"answer": "Hardcode credentials in the deployment script.",
"isCorrect": false,
"explanation": "Hardcoding credentials in scripts is a serious security risk, especially in source-controlled pipelines. Credentials could be exposed in logs or version history."
},
{
"answer": "Rely on the EC2 instance profile of the build server.",
"isCorrect": false,
"explanation": "While valid if the build server is an EC2 instance with an appropriate IAM role, this is not universally applicable. Environment variables are the more portable and explicit approach for CI/CD contexts."
},
{
"answer": "Use the `~/.aws/credentials` file on the build agent.",
"isCorrect": false,
"explanation": "Storing long-term credentials in a file on a shared build agent is a security risk. Environment variables injected per-pipeline run are safer and more appropriate."
}
]
},
{
"question": "An application making frequent DynamoDB calls starts receiving `ProvisionedThroughputExceededException` errors during peak traffic. What is the recommended retry strategy?",
"answers": [
{
"answer": "Implement exponential backoff with jitter before retrying the failed requests.",
"isCorrect": true,
"explanation": "Exponential backoff progressively increases wait time between retries, and jitter adds randomness to spread retries across time — preventing retry storms that would re-throttle the API immediately."
},
{
"answer": "Retry the request immediately in a tight loop until it succeeds.",
"isCorrect": false,
"explanation": "Immediately retrying without delay will compound the throttling problem. The high retry rate keeps hammering the same throttled endpoint."
},
{
"answer": "Switch to a fixed 5-second delay between all retries.",
"isCorrect": false,
"explanation": "A fixed delay is better than no delay, but it is inferior to exponential backoff with jitter. If many clients all use the same fixed delay, they will retry simultaneously, causing a retry storm."
},
{
"answer": "Catch the exception and fail the request immediately without retrying, since it is a permanent error.",
"isCorrect": false,
"explanation": "`ProvisionedThroughputExceededException` is a transient throttling signal, not a permanent error. AWS explicitly recommends retrying with exponential backoff."
}
]
},
{
"question": "Why is jitter important when implementing retry logic for AWS API calls?",
"answers": [
{
"answer": "It prevents multiple clients from retrying simultaneously after a throttle, avoiding a retry storm.",
"isCorrect": true,
"explanation": "Without jitter, all clients throttled at the same moment would retry after identical intervals, re-throttling the API immediately. Jitter randomizes wait times to spread retries across time."
},
{
"answer": "It increases the total number of retries allowed per request.",
"isCorrect": false,
"explanation": "Jitter does not affect the retry count. It only affects the timing of retries by adding randomness to wait intervals."
},
{
"answer": "It reduces the maximum backoff cap, making retries faster.",
"isCorrect": false,
"explanation": "Jitter does not change the maximum backoff cap. It randomizes the actual wait within the computed exponential interval, typically by multiplying by a random fraction."
},
{
"answer": "It ensures the SDK uses a different API endpoint on each retry.",
"isCorrect": false,
"explanation": "Jitter has nothing to do with endpoint selection. It is purely a time-based mechanism to spread retry attempts."
}
]
},
{
"question": "Which HTTP status code does AWS return when an API call is throttled?",
"answers": [
{
"answer": "429 Too Many Requests",
"isCorrect": true,
"explanation": "AWS returns HTTP 429 when a client exceeds the API's rate limits. This is a signal to back off and retry, not a fatal error."
},
{
"answer": "503 Service Unavailable",
"isCorrect": false,
"explanation": "503 can appear in specific cases (e.g., S3 `SlowDown`), but the standard throttling response across AWS APIs is 429."
},
{
"answer": "400 Bad Request",
"isCorrect": false,
"explanation": "400 indicates a malformed request or invalid parameters, not a throttling condition."
},
{
"answer": "500 Internal Server Error",
"isCorrect": false,
"explanation": "500 indicates a server-side error from AWS itself. Throttling is a client-side limit reflected by 429."
}
]
},
{
"question": "An S3 application storing billions of objects starts receiving `503 SlowDown` errors. What is the most effective mitigation?",
"answers": [
{
"answer": "Use randomized key prefixes to distribute objects across multiple S3 partitions.",
"isCorrect": true,
"explanation": "S3 rate limits are enforced per key prefix. Randomizing prefixes spreads traffic across multiple internal partitions, increasing effective throughput and reducing throttling."
},
{
"answer": "Switch to a single key prefix for all objects to simplify the namespace.",
"isCorrect": false,
"explanation": "Using a single prefix concentrates all requests on one partition, which would worsen throttling rather than mitigate it."
},
{
"answer": "Request a Service Quota increase for S3 object count.",
"isCorrect": false,
"explanation": "The `SlowDown` error is related to request rate per prefix, not total object count. A quota increase for object count would not resolve the throughput issue."
},
{
"answer": "Enable S3 Transfer Acceleration on the bucket.",
"isCorrect": false,
"explanation": "Transfer Acceleration improves upload speed over long distances by routing through CloudFront edge locations. It does not address per-prefix request rate throttling."
}
]
},
{
"question": "A Lambda function receives a `TooManyRequestsException`. What does this indicate?",
"answers": [
{
"answer": "The Lambda function has hit its concurrency limit.",
"isCorrect": true,
"explanation": "`TooManyRequestsException` from Lambda means the account-level or function-level concurrency limit has been reached. AWS throttles new invocations until concurrency frees up."
},
{
"answer": "The Lambda function's execution timeout has been exceeded.",
"isCorrect": false,
"explanation": "A timeout results in a `Task timed out` error, not `TooManyRequestsException`. The latter is specific to concurrency throttling."
},
{
"answer": "The Lambda function ran out of memory.",
"isCorrect": false,
"explanation": "Memory exhaustion causes the invocation to fail with an out-of-memory error, not a `TooManyRequestsException`."
},
{
"answer": "The Lambda function's deployment package is too large.",
"isCorrect": false,
"explanation": "Package size limits are enforced at deployment time, not at invocation time. `TooManyRequestsException` is a runtime throttling response."
}
]
},
{
"question": "A developer wants to view their current DynamoDB read/write capacity quotas and submit a limit increase request without opening a support ticket. What should they use?",
"answers": [
{
"answer": "The AWS Service Quotas console.",
"isCorrect": true,
"explanation": "The Service Quotas console provides a centralized view of current limits across all services and allows submitting increase requests directly, without needing to open a manual support ticket."
},
{
"answer": "The AWS Trusted Advisor console.",
"isCorrect": false,
"explanation": "Trusted Advisor can surface some limit warnings, but it does not allow you to submit quota increase requests. That is the function of the Service Quotas console."
},
{
"answer": "The AWS Cost Explorer console.",
"isCorrect": false,
"explanation": "Cost Explorer is for analyzing AWS spending and usage costs. It has no functionality related to service quotas or limit increases."
},
{
"answer": "The DynamoDB console's capacity settings page.",
"isCorrect": false,
"explanation": "The DynamoDB console lets you adjust provisioned capacity for specific tables, but it does not manage account-level service quotas or limit increase requests."
}
]
},
{
"question": "Which of the following are true about AWS service limits? (Select TWO)",
"answers": [
{
"answer": "Soft limits can be increased by submitting a request through the Service Quotas console.",
"isCorrect": true,
"explanation": "Soft limits are default quotas set by AWS that can be raised upon request. They are not fixed by AWS architecture."
},
{
"answer": "Hard limits can be increased if you have an Enterprise Support plan.",
"isCorrect": false,
"explanation": "Hard limits are fixed by AWS architecture and cannot be raised regardless of support plan tier."
},
{
"answer": "Hitting a service limit always indicates a bug in the application code.",
"isCorrect": false,
"explanation": "Hitting a limit can be a legitimate scaling scenario. The correct response may simply be to request a quota increase, not to fix code."
},
{
"answer": "Hard limits are fixed and cannot be changed by customers.",
"isCorrect": true,
"explanation": "Hard limits are architectural constraints set by AWS and are not adjustable, regardless of support plan or business justification."
}
]
},
{
"question": "Which AWS SDK language and its corresponding library is correctly matched?",
"answers": [
{
"answer": "Python → boto3",
"isCorrect": true,
"explanation": "boto3 is the official AWS SDK for Python. It is one of the most widely used SDKs and provides both resource-level and client-level interfaces to AWS services."
},
{
"answer": "Python → aws-sdk-js",
"isCorrect": false,
"explanation": "aws-sdk-js is the AWS SDK for JavaScript/Node.js, not Python. The Python SDK is boto3."
},
{
"answer": "Java → boto3",
"isCorrect": false,
"explanation": "boto3 is specific to Python. The AWS SDK for Java is a separate library."
},
{
"answer": "Go → aws-sdk-php",
"isCorrect": false,
"explanation": "aws-sdk-php is the SDK for PHP. Go has its own dedicated AWS SDK."
}
]
},
{
"question": "An AWS SDK automatically handles which of the following without requiring custom code from the developer? (Select TWO)",
"answers": [
{
"answer": "SigV4 request signing for authenticated API calls.",
"isCorrect": true,
"explanation": "AWS SDKs automatically sign all outgoing requests with Signature Version 4 (SigV4), which is required for authenticating to AWS APIs. Developers do not need to implement this themselves."
},
{
"answer": "Retrying throttled requests with exponential backoff.",
"isCorrect": true,
"explanation": "AWS SDKs include built-in retry logic with exponential backoff for retryable errors such as throttling exceptions. The maximum retry count is configurable."
},
{
"answer": "Automatically increasing DynamoDB provisioned capacity when throttled.",
"isCorrect": false,
"explanation": "SDKs do not modify your DynamoDB capacity settings. Scaling provisioned capacity requires explicit configuration (auto-scaling or manual adjustment)."
},
{
"answer": "Automatically rotating IAM access keys when they expire.",
"isCorrect": false,
"explanation": "SDKs do not rotate IAM keys. Key rotation is a separate IAM management concern. When using instance roles, the SDK refreshes temporary credentials automatically, but it does not rotate long-term keys."
}
]
},
{
"question": "A developer sets both the `AWS_ACCESS_KEY_ID` environment variable and has credentials in `~/.aws/credentials`. Which credentials will the AWS SDK use?",
"answers": [
{
"answer": "The environment variable credentials, because environment variables take precedence over the credentials file.",
"isCorrect": true,
"explanation": "In the SDK credential chain, environment variables (step 2) are evaluated before the shared credentials file (step 3). The first valid source wins."
},
{
"answer": "The credentials file, because it is more persistent than environment variables.",
"isCorrect": false,
"explanation": "Persistence has no bearing on the credential chain priority. Environment variables explicitly take precedence over the credentials file."
},
{
"answer": "Both sets of credentials are merged, with the credentials file taking priority for the secret key.",
"isCorrect": false,
"explanation": "Credential sources are not merged. The first complete, valid credential set found in the chain is used exclusively."
},
{
"answer": "The SDK will throw an error because multiple credential sources are defined.",
"isCorrect": false,
"explanation": "The SDK does not error on multiple credential sources. It simply follows the chain in order and uses the first valid set it finds."
}
]
},
{
"question": "Which command creates a new named AWS CLI profile called `staging`?",
"answers": [
{
"answer": "`aws configure --profile staging`",
"isCorrect": true,
"explanation": "The `--profile` flag on `aws configure` creates or updates a named profile in `~/.aws/credentials` and `~/.aws/config`, separate from the default profile."
},
{
"answer": "`aws configure create staging`",
"isCorrect": false,
"explanation": "`create` is not a subcommand of `aws configure`. The correct syntax uses the `--profile` flag."
},
{
"answer": "`aws profile --add staging`",
"isCorrect": false,
"explanation": "`aws profile` is not a valid AWS CLI command. Profile creation is done via `aws configure --profile <name>`."
},
{
"answer": "`aws configure set profile staging`",
"isCorrect": false,
"explanation": "`aws configure set` is used to set individual configuration values, not to create a new named profile interactively."
}
]
},
{
"question": "A developer is debugging why their application is using unexpected AWS credentials. In what order should they check credential sources to trace the issue?",
"answers": [
{
"answer": "Check explicit code credentials → environment variables → `~/.aws/credentials` → `~/.aws/config` → container/task role → EC2 instance profile.",
"isCorrect": true,
"explanation": "This mirrors the SDK credential chain priority. Checking in this order ensures you identify the active credential source, since the first valid source in the chain is what the SDK uses."
},
{
"answer": "Check EC2 instance profile first, then work backwards through the chain.",
"isCorrect": false,
"explanation": "The instance profile has the lowest priority in the chain. Checking it first would likely not find the active credentials if a higher-priority source is set."
},
{
"answer": "Check `~/.aws/credentials` first, since it is the most commonly used source.",
"isCorrect": false,
"explanation": "Environment variables and explicit code credentials both take precedence over the credentials file. Starting with the credentials file would skip higher-priority sources."
},
{
"answer": "The SDK uses all credential sources simultaneously, so the order does not matter for debugging.",
"isCorrect": false,
"explanation": "The SDK uses the first valid credential source it finds, in a strict priority order. Understanding that order is essential for debugging credential resolution issues."
}
]
}
]
{{< /qcm >}}