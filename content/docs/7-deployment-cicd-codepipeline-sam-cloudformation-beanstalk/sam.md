---
title: "20. SAM (Serverless Application Model)"
type: docs
weight: 2
---

## SAM (Serverless Application Model)

Building serverless applications by hand means writing long, verbose CloudFormation templates just to define a Lambda function with an API Gateway trigger and a DynamoDB table. AWS SAM (Serverless Application Model) solves this by providing a shorthand syntax on top of CloudFormation, specifically designed for serverless resources. A few lines of SAM YAML expand into the dozens of CloudFormation lines you'd otherwise have to maintain. Beyond templating, SAM also ships a CLI that lets you build, test locally, and deploy serverless applications — making the entire development loop faster and safer.

SAM is not a separate service — it's a CloudFormation transform. Every SAM template is ultimately converted into a standard CloudFormation template before deployment.

### SAM Template Structure

Every SAM template must declare the transform at the top. This single line is what tells CloudFormation to process the template through the SAM transformer:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
```

From there, the template follows the same structure as CloudFormation — `Parameters`, `Globals`, `Resources`, `Outputs` — but you can use SAM-specific resource types inside `Resources`. The full template reference is available here: [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification.html)

**SAM resource types** are the core of what makes SAM concise. The most commonly used ones are:

- **`AWS::Serverless::Function`** — defines a Lambda function, its runtime, handler, memory, timeout, and event triggers (API Gateway, SQS, S3, DynamoDB Streams, etc.) all in one block. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-function.html)
- **`AWS::Serverless::Api`** — creates a REST API Gateway with stages, auth, and CORS settings. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-api.html)
- **`AWS::Serverless::HttpApi`** — lighter-weight HTTP API (API Gateway v2), lower latency and cost for simple use cases. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-httpapi.html)
- **`AWS::Serverless::SimpleTable`** — provisions a DynamoDB table with a single primary key in one line. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-simpletable.html)
- **`AWS::Serverless::LayerVersion`** — packages and deploys a Lambda Layer (shared dependencies, utilities). [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-layerversion.html)

A minimal but complete example — a Lambda function exposed via an HTTP API:

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31

Resources:
  HelloFunction:
    Type: AWS::Serverless::Function
    Properties:
      Handler: app.lambda_handler
      Runtime: python3.12
      Events:
        HelloApi:
          Type: HttpApi
          Properties:
            Path: /hello
            Method: GET
```

This single block generates the Lambda function, the HTTP API Gateway, the necessary IAM execution role, and the permission for API Gateway to invoke Lambda — all automatically.

**The `Globals` section** lets you define default properties shared across all SAM resources of a given type, avoiding repetition. For example, if all your functions share the same runtime, timeout, and environment variables, you declare them once in `Globals` instead of repeating them on every function:

```yaml
Globals:
  Function:
    Runtime: python3.12
    Timeout: 30
    Environment:
      Variables:
        TABLE_NAME: !Ref MyTable
```

Individual resources can still override any global value. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification-template-anatomy-globals.html)

**SAM policy templates** are another productivity shortcut — pre-built IAM policy statements for common patterns (read from S3, write to DynamoDB, publish to SNS, etc.) that you attach to a function without writing inline IAM JSON. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-policy-templates.html)

```yaml
Policies:
  - DynamoDBCrudPolicy:
      TableName: !Ref MyTable
```

### SAM CLI

The SAM CLI is the command-line companion for the entire development lifecycle. Install it locally and it handles everything from scaffolding to production deployment. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)

The key commands and what they do:

- **`sam init`** — scaffolds a new project from a template (language, runtime, event source). Good starting point for any new serverless app.
- **`sam build`** — compiles your code and dependencies into a `.aws-sam/build` directory, ready for local testing or deployment. For interpreted languages like Python, it resolves `requirements.txt`; for compiled languages, it runs the build toolchain.
- **`sam local invoke`** — invokes a single Lambda function locally using Docker, passing a JSON event file. Useful for unit-testing a function in isolation.

```bash
  sam local invoke HelloFunction --event events/event.json
```

- **`sam local start-api`** — starts a local HTTP server that simulates API Gateway in front of your Lambda functions. You can hit `http://localhost:3000/hello` directly from a browser or curl while your code runs in Docker locally.
- **`sam package`** — zips your build artifacts and uploads them to S3, producing a deployment-ready template with S3 references replacing local paths. (In modern workflows, `sam deploy` handles this step automatically.)
- **`sam deploy`** — deploys (or updates) the CloudFormation stack. Running it with the `--guided` flag triggers an interactive prompt the first time, asking for stack name, region, S3 bucket, and other options. The answers are saved to `samconfig.toml` so subsequent deploys can run non-interactively with just `sam deploy`.

The `samconfig.toml` file acts as a persistent configuration file for your project's deploy settings, making it easy to commit deployment parameters to source control without re-entering them every time. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-config.html)

### Local Testing with Lambda Event Mocks

When using `sam local invoke`, you supply a JSON file that simulates the event payload Lambda would receive in production. SAM ships with a helper command to generate these event payloads for common sources:

```bash
sam local generate-event apigateway http-api-proxy > events/apigw_event.json
sam local invoke HelloFunction --event events/apigw_event.json
```

This lets you test your handler logic against realistic event shapes — API Gateway requests, S3 notifications, SQS messages — without deploying to AWS first. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/using-sam-cli-local-invoke.html)

### SAM + CodeDeploy for Safe Lambda Deployments

When you update a Lambda function, the naive approach is to immediately shift 100% of traffic to the new version. If the new version has a bug, all requests fail instantly. SAM integrates with CodeDeploy to enable **traffic shifting via Lambda aliases**, which provides a safe, gradual rollout.

To enable this, you configure a `DeploymentPreference` on your function:

```yaml
HelloFunction:
  Type: AWS::Serverless::Function
  Properties:
    ...
    AutoPublishAlias: live
    DeploymentPreference:
      Type: Canary10Percent5Minutes
```

`AutoPublishAlias` tells SAM to automatically publish a new Lambda version and update the `live` alias on every deploy. `DeploymentPreference` instructs CodeDeploy on how to shift traffic from the old version to the new one. The available strategies are:

- **Canary** — sends a small percentage of traffic to the new version for a set period, then shifts the rest. Example: `Canary10Percent5Minutes` routes 10% of traffic to the new version for 5 minutes before completing the rollout.
- **Linear** — shifts traffic incrementally at a fixed rate over time. Example: `Linear10PercentEvery1Minute` adds 10% more traffic to the new version every minute.
- **AllAtOnce** — shifts all traffic immediately (no gradual rollout, equivalent to a standard deploy).

You can also attach CloudWatch alarms to the `DeploymentPreference`. If an alarm fires during the traffic-shifting window — for example, error rate spikes — CodeDeploy automatically rolls back to the previous version with zero manual intervention. [🔗](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/automating-updates-to-serverless-apps.html)

This SAM + CodeDeploy integration gives you production-grade deployment safety for Lambda without having to configure CodeDeploy resources manually.