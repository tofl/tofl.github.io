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

{{< qcm >}}
[
{
"question": "What is AWS SAM (Serverless Application Model) at its core?",
"answers": [
{
"answer": "A separate AWS service that manages serverless deployments independently of CloudFormation",
"isCorrect": false,
"explanation": "SAM is not a separate service. It is built on top of CloudFormation as a transform, and every SAM template is ultimately converted into a standard CloudFormation template before deployment."
},
{
"answer": "A CloudFormation transform that provides a shorthand syntax for defining serverless resources",
"isCorrect": true,
"explanation": "SAM is a CloudFormation transform. It extends CloudFormation with a concise, serverless-focused syntax, and the SAM transformer converts SAM templates into full CloudFormation templates at deploy time."
},
{
"answer": "A container orchestration tool for running Lambda functions locally",
"isCorrect": false,
"explanation": "SAM does include local testing capabilities via its CLI, but its core purpose is to act as a CloudFormation transform with a shorthand syntax for serverless resources, not container orchestration."
},
{
"answer": "An Infrastructure-as-Code tool completely independent of CloudFormation",
"isCorrect": false,
"explanation": "SAM is tightly coupled with CloudFormation. It is not independent — every SAM template is processed by the SAM transformer and converted into a standard CloudFormation template before any resources are provisioned."
}
]
},
{
"question": "Which line is mandatory at the top of every SAM template to enable SAM-specific resource types?",
"answers": [
{
"answer": "Transform: AWS::Serverless-2016-10-31",
"isCorrect": true,
"explanation": "This Transform declaration tells CloudFormation to process the template through the SAM transformer, enabling the use of SAM-specific resource types like AWS::Serverless::Function."
},
{
"answer": "AWSTemplateFormatVersion: '2010-09-09'",
"isCorrect": false,
"explanation": "While this line is commonly included, it is the standard CloudFormation version declaration and is not what enables SAM processing. The Transform line is what activates the SAM transformer."
},
{
"answer": "SAMVersion: '2016-10-31'",
"isCorrect": false,
"explanation": "This is not a valid SAM or CloudFormation directive. The correct declaration is 'Transform: AWS::Serverless-2016-10-31'."
},
{
"answer": "Globals: Function",
"isCorrect": false,
"explanation": "The Globals section is optional and is used to define shared default properties across SAM resources. It does not activate the SAM transformer — only the Transform declaration does."
}
]
},
{
"question": "A developer wants to define a Lambda function that is triggered by an HTTP GET request in a SAM template with minimal configuration. Which SAM resource type is best suited for this use case?",
"answers": [
{
"answer": "AWS::Serverless::Api",
"isCorrect": false,
"explanation": "AWS::Serverless::Api creates a REST API (API Gateway v1), which is heavier and more feature-rich. For simple HTTP trigger use cases, AWS::Serverless::HttpApi (API Gateway v2) is preferred for lower latency and cost."
},
{
"answer": "AWS::Serverless::Function with an HttpApi event type",
"isCorrect": true,
"explanation": "AWS::Serverless::Function with an HttpApi event type uses API Gateway v2 (HTTP API), which is the lighter-weight option recommended for simple use cases. SAM automatically provisions the function, the HTTP API, the IAM role, and the necessary permissions."
},
{
"answer": "AWS::Serverless::SimpleTable",
"isCorrect": false,
"explanation": "AWS::Serverless::SimpleTable provisions a DynamoDB table, not a Lambda function or HTTP endpoint. It is unrelated to this use case."
},
{
"answer": "AWS::Lambda::Function with an AWS::ApiGateway::RestApi",
"isCorrect": false,
"explanation": "While this would work using raw CloudFormation, it requires many more lines of configuration. The whole purpose of SAM is to simplify this with concise resource types like AWS::Serverless::Function."
}
]
},
{
"question": "What is the purpose of the Globals section in a SAM template?",
"answers": [
{
"answer": "To define IAM roles that apply globally across all AWS accounts",
"isCorrect": false,
"explanation": "The Globals section has nothing to do with cross-account IAM roles. It is used to define default property values shared across SAM resources of a given type within a single template."
},
{
"answer": "To define default properties shared across all SAM resources of a given type, reducing repetition",
"isCorrect": true,
"explanation": "The Globals section lets you declare common properties (such as Runtime, Timeout, or Environment variables) once for all resources of a type. Individual resources can still override any global value."
},
{
"answer": "To declare CloudFormation parameters that are passed at deploy time",
"isCorrect": false,
"explanation": "Deploy-time parameters are declared in the Parameters section, not Globals. The Globals section sets default property values for SAM resource types."
},
{
"answer": "To define global environment variables that are injected into every AWS service in the account",
"isCorrect": false,
"explanation": "Globals only affects the SAM resources defined within the same template. It does not have any account-wide scope."
}
]
},
{
"question": "Which SAM resource type would you use to provision a DynamoDB table with a single primary key using the least amount of configuration?",
"answers": [
{
"answer": "AWS::DynamoDB::Table",
"isCorrect": false,
"explanation": "AWS::DynamoDB::Table is a standard CloudFormation resource that requires more verbose configuration. SAM provides the shorthand AWS::Serverless::SimpleTable for this common use case."
},
{
"answer": "AWS::Serverless::SimpleTable",
"isCorrect": true,
"explanation": "AWS::Serverless::SimpleTable is the SAM shorthand that provisions a DynamoDB table with a single primary key in minimal configuration, which is exactly the intended use case."
},
{
"answer": "AWS::Serverless::Api",
"isCorrect": false,
"explanation": "AWS::Serverless::Api creates a REST API Gateway, not a DynamoDB table."
},
{
"answer": "AWS::Serverless::LayerVersion",
"isCorrect": false,
"explanation": "AWS::Serverless::LayerVersion is used to package and deploy Lambda Layers (shared dependencies), not DynamoDB tables."
}
]
},
{
"question": "What does the sam build command do?",
"answers": [
{
"answer": "Deploys the CloudFormation stack to AWS",
"isCorrect": false,
"explanation": "Deployment is handled by sam deploy, not sam build. The build step only compiles and packages the application locally."
},
{
"answer": "Compiles code and resolves dependencies into the .aws-sam/build directory",
"isCorrect": true,
"explanation": "sam build compiles your application code and resolves dependencies (e.g., requirements.txt for Python) into the .aws-sam/build directory, preparing the artifacts for local testing or deployment."
},
{
"answer": "Starts a local HTTP server that simulates API Gateway",
"isCorrect": false,
"explanation": "Starting a local API Gateway simulation is done with sam local start-api. The sam build command only prepares build artifacts locally."
},
{
"answer": "Uploads build artifacts to an S3 bucket",
"isCorrect": false,
"explanation": "Uploading artifacts to S3 was previously handled by sam package, and is now done automatically by sam deploy. The sam build command only compiles locally."
}
]
},
{
"question": "A developer wants to test a Lambda function locally by passing a simulated SQS event payload without deploying to AWS. Which SAM CLI command should they use?",
"answers": [
{
"answer": "sam local start-api",
"isCorrect": false,
"explanation": "sam local start-api starts a local HTTP server simulating API Gateway. It is not designed for directly invoking a function with a custom event payload like an SQS message."
},
{
"answer": "sam local invoke",
"isCorrect": true,
"explanation": "sam local invoke runs a single Lambda function locally using Docker and accepts a JSON event file. This is the correct command for testing a function in isolation with a simulated event such as an SQS message."
},
{
"answer": "sam deploy --local",
"isCorrect": false,
"explanation": "There is no --local flag for sam deploy. sam deploy is used to deploy the CloudFormation stack to AWS, not for local testing."
},
{
"answer": "sam build --invoke",
"isCorrect": false,
"explanation": "sam build does not have an --invoke flag. It only compiles and packages the application. Local invocation is a separate step done with sam local invoke."
}
]
},
{
"question": "What does running sam deploy --guided do?",
"answers": [
{
"answer": "Runs a syntax validation on the SAM template and reports any errors",
"isCorrect": false,
"explanation": "Template validation is not the purpose of --guided. The --guided flag triggers an interactive prompt that collects deployment configuration such as stack name, region, and S3 bucket."
},
{
"answer": "Triggers an interactive prompt to collect deployment settings and saves them to samconfig.toml",
"isCorrect": true,
"explanation": "The --guided flag prompts the user for deployment parameters (stack name, region, S3 bucket, etc.) the first time and saves the answers to samconfig.toml, enabling future non-interactive deploys with just sam deploy."
},
{
"answer": "Deploys the application step by step, pausing for user confirmation before each CloudFormation resource is created",
"isCorrect": false,
"explanation": "sam deploy --guided does not pause between resource creations. It collects configuration interactively at the start and then proceeds with the deployment."
},
{
"answer": "Opens a web-based guided wizard in the AWS Management Console",
"isCorrect": false,
"explanation": "The SAM CLI is a command-line tool; it does not open web browser consoles. The --guided flag launches an interactive CLI prompt, not a browser-based wizard."
}
]
},
{
"question": "What is the purpose of the samconfig.toml file?",
"answers": [
{
"answer": "It stores the SAM template syntax and resource definitions",
"isCorrect": false,
"explanation": "SAM resource definitions are stored in the template.yaml file, not samconfig.toml. The samconfig.toml file stores deployment configuration parameters."
},
{
"answer": "It acts as a persistent configuration file for deployment settings, allowing non-interactive subsequent deploys",
"isCorrect": true,
"explanation": "samconfig.toml stores deployment parameters (stack name, region, S3 bucket, etc.) collected during sam deploy --guided, so that future deploys can run non-interactively with just sam deploy."
},
{
"answer": "It defines the Docker configuration used by sam local invoke",
"isCorrect": false,
"explanation": "Docker configuration for local testing is not stored in samconfig.toml. That file is specifically for storing sam deploy settings."
},
{
"answer": "It is used by CodeDeploy to determine traffic shifting strategies",
"isCorrect": false,
"explanation": "Traffic shifting strategies are configured within the SAM template under DeploymentPreference, not in samconfig.toml."
}
]
},
{
"question": "How can a developer generate a realistic API Gateway event payload to use with sam local invoke?",
"answers": [
{
"answer": "By manually writing the JSON event file based on the AWS documentation",
"isCorrect": false,
"explanation": "While possible, this is not the most efficient approach. SAM provides the sam local generate-event command to automatically generate realistic event payloads for common sources."
},
{
"answer": "By using the sam local generate-event command to produce a sample event JSON file",
"isCorrect": true,
"explanation": "sam local generate-event produces realistic event payload JSON files for common event sources (API Gateway, S3, SQS, etc.), which can then be passed directly to sam local invoke for local testing."
},
{
"answer": "By running sam deploy in dry-run mode, which captures a live event",
"isCorrect": false,
"explanation": "There is no dry-run mode in sam deploy that captures events. Event payloads for local testing are generated with sam local generate-event."
},
{
"answer": "By using sam build --generate-events",
"isCorrect": false,
"explanation": "sam build does not have a --generate-events flag. Event generation is a separate SAM CLI feature accessible via sam local generate-event."
}
]
},
{
"question": "A team is deploying a new version of a Lambda function and wants to route only 10% of traffic to the new version for 5 minutes before completing the rollout. Which DeploymentPreference type should they configure in SAM?",
"answers": [
{
"answer": "Linear10PercentEvery1Minute",
"isCorrect": false,
"explanation": "Linear strategies shift traffic incrementally at a fixed rate over time. Linear10PercentEvery1Minute would add 10% more traffic every minute, not hold at 10% for a fixed period before completing."
},
{
"answer": "Canary10Percent5Minutes",
"isCorrect": true,
"explanation": "Canary10Percent5Minutes routes 10% of traffic to the new Lambda version for 5 minutes, then shifts the remaining 90% all at once if no alarms fire. This matches the described requirement exactly."
},
{
"answer": "AllAtOnce",
"isCorrect": false,
"explanation": "AllAtOnce shifts 100% of traffic to the new version immediately, with no gradual rollout. This is the opposite of what the team wants."
},
{
"answer": "Canary5Percent10Minutes",
"isCorrect": false,
"explanation": "While this is a valid Canary pattern format, it would route 5% of traffic for 10 minutes, not 10% for 5 minutes as specified."
}
]
},
{
"question": "What does the AutoPublishAlias property do in a SAM function with CodeDeploy integration?",
"answers": [
{
"answer": "It automatically creates a new Lambda function version and updates the specified alias on every deploy",
"isCorrect": true,
"explanation": "AutoPublishAlias instructs SAM to automatically publish a new Lambda version and point the named alias (e.g., 'live') to it on each deployment, which is required for CodeDeploy traffic shifting to work."
},
{
"answer": "It publishes the Lambda function to the AWS Serverless Application Repository automatically",
"isCorrect": false,
"explanation": "AutoPublishAlias has nothing to do with the Serverless Application Repository. It creates a Lambda version alias used by CodeDeploy to manage traffic shifting."
},
{
"answer": "It enables automatic rollback of the Lambda function if an error occurs",
"isCorrect": false,
"explanation": "Automatic rollback is configured via CloudWatch alarms attached to the DeploymentPreference, not by AutoPublishAlias. AutoPublishAlias only handles version publication and alias updates."
},
{
"answer": "It creates an alias that is used as an API Gateway stage name",
"isCorrect": false,
"explanation": "The alias created by AutoPublishAlias is a Lambda alias used for traffic shifting with CodeDeploy, not an API Gateway stage name."
}
]
},
{
"question": "Which of the following deployment strategies in SAM + CodeDeploy provides NO gradual traffic shifting?",
"answers": [
{
"answer": "Canary10Percent5Minutes",
"isCorrect": false,
"explanation": "Canary strategies do provide gradual shifting — a small percentage of traffic is sent to the new version for a period before the full cutover."
},
{
"answer": "Linear10PercentEvery10Minutes",
"isCorrect": false,
"explanation": "Linear strategies shift traffic incrementally at a fixed rate over time, which is a form of gradual traffic shifting."
},
{
"answer": "AllAtOnce",
"isCorrect": true,
"explanation": "AllAtOnce shifts 100% of traffic to the new Lambda version immediately, with no gradual rollout. It is equivalent to a standard deploy and provides no traffic shifting safety."
},
{
"answer": "Canary5Percent30Minutes",
"isCorrect": false,
"explanation": "This is a Canary strategy that routes a small percentage of traffic to the new version for 30 minutes before completing, which is gradual by definition."
}
]
},
{
"question": "What happens when a CloudWatch alarm fires during a CodeDeploy traffic-shifting window configured in SAM?",
"answers": [
{
"answer": "CodeDeploy pauses the deployment and waits for manual approval to continue",
"isCorrect": false,
"explanation": "CodeDeploy does not simply pause and wait. When an attached CloudWatch alarm fires, it automatically rolls back traffic to the previous Lambda version with no manual intervention required."
},
{
"answer": "CodeDeploy automatically rolls back to the previous Lambda version",
"isCorrect": true,
"explanation": "If a CloudWatch alarm fires during the traffic-shifting window, CodeDeploy automatically triggers a rollback to the previous Lambda version, providing zero-downtime safety without manual intervention."
},
{
"answer": "The deployment continues but an SNS notification is sent to the team",
"isCorrect": false,
"explanation": "The deployment does not continue unaffected. A CloudWatch alarm firing during the window triggers an automatic rollback, not just a notification."
},
{
"answer": "All traffic is immediately shifted to the new version to minimize the alarm duration",
"isCorrect": false,
"explanation": "This is the opposite of what happens. A CloudWatch alarm during traffic shifting causes CodeDeploy to roll back to the previous version, not accelerate the deployment."
}
]
},
{
"question": "What is the role of SAM policy templates?",
"answers": [
{
"answer": "They are pre-built IAM policy statements for common patterns that can be attached to a Lambda function without writing inline IAM JSON",
"isCorrect": true,
"explanation": "SAM policy templates (e.g., DynamoDBCrudPolicy, S3ReadPolicy) are shorthand references to pre-built IAM policies that cover common serverless access patterns, eliminating the need to write verbose inline IAM JSON."
},
{
"answer": "They define resource-based policies applied to API Gateway stages",
"isCorrect": false,
"explanation": "SAM policy templates are IAM policies attached to Lambda functions, not resource-based policies for API Gateway stages."
},
{
"answer": "They are CloudFormation Conditions that control which resources are deployed in different environments",
"isCorrect": false,
"explanation": "CloudFormation Conditions are a separate concept. SAM policy templates are specifically pre-built IAM policy statements for common Lambda permission patterns."
},
{
"answer": "They automatically generate least-privilege IAM roles by analyzing the Lambda function's code",
"isCorrect": false,
"explanation": "SAM policy templates do not analyze code. They are pre-written IAM policy snippets for common patterns that a developer explicitly attaches to a function."
}
]
},
{
"question": "Which SAM CLI command would you use to scaffold a new serverless project from a template, including selecting the runtime and event source?",
"answers": [
{
"answer": "sam build",
"isCorrect": false,
"explanation": "sam build compiles an existing project's code and dependencies. It does not scaffold a new project."
},
{
"answer": "sam init",
"isCorrect": true,
"explanation": "sam init scaffolds a new serverless project by prompting the developer to choose a language, runtime, and event source template, creating the initial project structure."
},
{
"answer": "sam deploy --init",
"isCorrect": false,
"explanation": "There is no --init flag for sam deploy. Project scaffolding is handled by sam init."
},
{
"answer": "sam local start-api",
"isCorrect": false,
"explanation": "sam local start-api starts a local HTTP server simulating API Gateway for an existing project. It does not scaffold new projects."
}
]
},
{
"question": "A developer runs sam local start-api. What can they do next?",
"answers": [
{
"answer": "Invoke Lambda functions locally via HTTP requests to localhost:3000 without deploying to AWS",
"isCorrect": true,
"explanation": "sam local start-api starts a local HTTP server (on localhost:3000 by default) that simulates API Gateway. HTTP requests are routed to Lambda functions running in local Docker containers, enabling full local testing without AWS deployment."
},
{
"answer": "Deploy the application to a staging environment in AWS",
"isCorrect": false,
"explanation": "sam local start-api runs everything locally using Docker. Deploying to AWS is done with sam deploy."
},
{
"answer": "Generate CloudFormation change sets to preview what will be deployed",
"isCorrect": false,
"explanation": "Generating CloudFormation change sets is part of the sam deploy process, not sam local start-api, which is strictly for local HTTP testing."
},
{
"answer": "Automatically push function logs to CloudWatch",
"isCorrect": false,
"explanation": "sam local start-api runs functions locally in Docker and outputs logs to the local terminal. It does not push logs to CloudWatch."
}
]
},
{
"question": "Which of the following correctly describes the difference between AWS::Serverless::Api and AWS::Serverless::HttpApi in SAM?",
"answers": [
{
"answer": "AWS::Serverless::Api creates a REST API (API Gateway v1) with full features; AWS::Serverless::HttpApi creates a lighter HTTP API (API Gateway v2) with lower latency and cost",
"isCorrect": true,
"explanation": "AWS::Serverless::Api maps to REST APIs (API Gateway v1), which support more advanced features. AWS::Serverless::HttpApi maps to HTTP APIs (API Gateway v2), designed for simpler use cases with lower latency and cost."
},
{
"answer": "AWS::Serverless::Api is used for WebSocket APIs; AWS::Serverless::HttpApi is used for REST APIs",
"isCorrect": false,
"explanation": "This is incorrect. AWS::Serverless::Api is for REST APIs (v1) and AWS::Serverless::HttpApi is for HTTP APIs (v2). SAM does not have a dedicated WebSocket API resource type."
},
{
"answer": "They are interchangeable and produce identical API Gateway configurations",
"isCorrect": false,
"explanation": "They are not interchangeable. AWS::Serverless::Api (REST API v1) and AWS::Serverless::HttpApi (HTTP API v2) differ in features, latency, and cost."
},
{
"answer": "AWS::Serverless::HttpApi supports more advanced authorization and CORS features than AWS::Serverless::Api",
"isCorrect": false,
"explanation": "It is the opposite — AWS::Serverless::Api (REST API v1) supports more advanced features including authorization options. AWS::Serverless::HttpApi is intentionally lightweight."
}
]
}
]
{{< /qcm >}}