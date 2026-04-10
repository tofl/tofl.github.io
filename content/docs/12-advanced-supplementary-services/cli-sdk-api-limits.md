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