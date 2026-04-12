---
title: "24. AppConfig"
type: docs
weight: 6
---

## AppConfig

Deploying a new version of your application every time you want to change a configuration value — a feature flag, a timeout, a rate limit — is slow, risky, and wasteful. AWS AppConfig [🔗](https://docs.aws.amazon.com/appconfig/latest/userguide/what-is-appconfig.html) solves this by letting you deploy configuration changes independently of code, with built-in validation, gradual rollout, and automatic rollback. It's especially useful for **feature flags**: you can enable a new feature for 10% of users, watch your error metrics, and expand (or roll back) without touching a deployment pipeline.

### Core Concepts

AppConfig organizes everything into three layers:

- **Application** — a logical grouping (e.g., `my-api`, `checkout-service`). It's just a container.
- **Environment** — a deployment target within that application: `prod`, `staging`, `dev`. Each environment gets its own deployment history and rollback state.
- **Configuration profile** — the actual configuration data, plus where it lives and how it should be validated.

When you deploy, you're pushing a version of a configuration profile to a specific environment using a deployment strategy.

### Configuration Sources

AppConfig doesn't force you to store config in yet another place. A configuration profile points to one of several sources [🔗](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-configuration-and-profile.html):

- **Hosted configuration** — stored directly in AppConfig (simplest option; versioned automatically).
- **S3** — reference a JSON/YAML file in a bucket.
- **SSM Parameter Store** — pull from an existing parameter.
- **SSM Document** — use a Systems Manager document as the config source.

For most greenfield use cases, hosted configuration is the right default. Use SSM Parameter Store or S3 when you already have config living there and don't want to migrate it.

### Validators

Before AppConfig deploys a new configuration version, it can validate it to prevent bad data from reaching production [🔗](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-configuration-and-profile.html#appconfig-creating-configuration-and-profile-validators):

- **JSON Schema validator** — AppConfig checks the incoming JSON against a schema you provide. Catches structural errors (missing keys, wrong types) before deployment starts.
- **Lambda validator** — AppConfig invokes a Lambda function with the configuration content. Your function can apply any custom logic (e.g., checking that a percentage value is between 0 and 100) and return a pass/fail result.

Both validator types run automatically whenever you start a deployment. If validation fails, the deployment is blocked.

### Deployment Strategies

AppConfig doesn't flip configuration atomically across all instances at once (unless you tell it to). It uses **deployment strategies** to control the rollout pace [🔗](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-creating-deployment-strategy.html):

- **AllAtOnce** — every client gets the new config immediately. Fast, but no gradual exposure.
- **Linear** — AppConfig releases the configuration to an increasing percentage of clients at a fixed rate over a defined interval (e.g., 10% every 5 minutes).
- **Exponential** — similar to Linear but the growth rate accelerates over time (10%, 20%, 40%…). Slower to start, faster to finish.

AWS provides built-in strategies (e.g., `AppConfig.AllAtOnce`, `AppConfig.Linear50PercentEvery30Seconds`) so you don't always need to define your own.

### Rollback on CloudWatch Alarm

The main safety mechanism in AppConfig is **automatic rollback triggered by a CloudWatch alarm** [🔗](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-deploying-appconfig-configuration-rollback.html). During a deployment, you associate one or more CloudWatch alarms (e.g., an elevated error rate or a Lambda throttle alarm) with the deployment. If any alarm fires, AppConfig immediately rolls back to the previous known-good configuration version — no human intervention required.

This is what makes gradual rollout genuinely safe: you bake in your error-rate alarm, start a Linear deployment, and AppConfig self-corrects if anything goes wrong.

### AppConfig Agent

Polling the AppConfig API on every request would be slow and expensive. The **AppConfig Agent** [🔗](https://docs.aws.amazon.com/appconfig/latest/userguide/appconfig-agent.html) is a sidecar process (available as a Lambda extension or a containerized agent) that runs alongside your application and handles retrieval and caching locally. Your application calls a local HTTP endpoint (`localhost:2772`) instead of the AWS API directly. The agent takes care of:

- Polling AppConfig in the background at a configurable interval.
- Caching the latest configuration in memory.
- Returning the cached value instantly to your application.

This makes AppConfig practical even for high-throughput services — your code sees sub-millisecond config reads from the local cache, not network calls.

### Feature Flags Use Case

A typical feature flag workflow with AppConfig looks like this:

1. Create a hosted configuration profile with a JSON document: `{ "new_checkout_flow": false }`.
2. Add a JSON Schema validator that enforces the boolean type.
3. Associate a CloudWatch alarm that watches your checkout error rate.
4. When ready to roll out, update the config to `true` and deploy using a Linear strategy.
5. AppConfig gradually exposes the new value; if errors spike, it rolls back automatically.

Your application retrieves the flag via the AppConfig Agent (`GET http://localhost:2772/applications/my-api/environments/prod/configurations/flags`) and branches on the value. No redeployment, no SSH, no restart.

For the exam, keep in mind that AppConfig is the go-to answer whenever a question describes needing to change configuration without redeploying code, safely roll out feature flags, or validate config before it reaches production.

{{< qcm >}}
[
{
"question": "A company wants to enable a new feature for a gradually increasing percentage of users without redeploying their application. They also want automatic rollback if error rates increase. Which AWS service best fits this requirement?",
"answers": [
{
"answer": "AWS Systems Manager Parameter Store",
"isCorrect": false,
"explanation": "Parameter Store can store configuration values, but it does not natively support gradual rollout strategies or automatic rollback based on CloudWatch alarms."
},
{
"answer": "AWS AppConfig",
"isCorrect": true,
"explanation": "AppConfig is purpose-built for deploying configuration changes (including feature flags) independently of code, with support for gradual deployment strategies and automatic rollback triggered by CloudWatch alarms."
},
{
"answer": "AWS CodeDeploy",
"isCorrect": false,
"explanation": "CodeDeploy handles application code deployments, not configuration changes. It is not designed for feature flag management or configuration-only rollouts."
},
{
"answer": "AWS Secrets Manager",
"isCorrect": false,
"explanation": "Secrets Manager is designed for storing and rotating secrets (credentials, API keys), not for managing feature flags or gradual configuration rollouts."
}
]
},
{
"question": "Which of the following are valid configuration sources for an AWS AppConfig configuration profile? (Select THREE)",
"answers": [
{
"answer": "Hosted configuration stored directly in AppConfig",
"isCorrect": true,
"explanation": "AppConfig supports hosted configuration as its simplest option — data is stored directly in AppConfig and versioned automatically."
},
{
"answer": "An S3 bucket containing a JSON or YAML file",
"isCorrect": true,
"explanation": "AppConfig can reference a configuration file stored in an S3 bucket, which is useful when config already resides there."
},
{
"answer": "AWS SSM Parameter Store",
"isCorrect": true,
"explanation": "AppConfig can pull configuration from an existing SSM Parameter Store parameter, avoiding the need to migrate existing config data."
},
{
"answer": "An Amazon DynamoDB table",
"isCorrect": false,
"explanation": "DynamoDB is not a supported configuration source for AppConfig. Supported sources include hosted configuration, S3, SSM Parameter Store, and SSM Documents."
},
{
"answer": "AWS Secrets Manager",
"isCorrect": false,
"explanation": "Secrets Manager is not a supported AppConfig configuration source. It is used for secrets rotation and retrieval, not configuration management via AppConfig."
}
]
},
{
"question": "An AppConfig deployment strategy is configured to release configuration to 10% of clients, then 20%, then 40%, accelerating over time. Which built-in strategy type does this describe?",
"answers": [
{
"answer": "AllAtOnce",
"isCorrect": false,
"explanation": "AllAtOnce pushes the new configuration to all clients simultaneously, with no gradual exposure or acceleration."
},
{
"answer": "Linear",
"isCorrect": false,
"explanation": "A Linear strategy increases exposure at a fixed, constant rate (e.g., 10% every 5 minutes), not an accelerating rate."
},
{
"answer": "Exponential",
"isCorrect": true,
"explanation": "An Exponential strategy starts slowly and accelerates over time (e.g., 10%, 20%, 40%…), providing cautious early exposure followed by faster rollout completion."
},
{
"answer": "Canary",
"isCorrect": false,
"explanation": "'Canary' is not a named AppConfig deployment strategy type. AppConfig uses AllAtOnce, Linear, and Exponential strategies."
}
]
},
{
"question": "A developer configures an AWS AppConfig deployment with a CloudWatch alarm monitoring the application's error rate. What happens if the alarm fires during a deployment?",
"answers": [
{
"answer": "The deployment pauses until the alarm clears, then resumes automatically.",
"isCorrect": false,
"explanation": "AppConfig does not pause and resume deployments. If an associated CloudWatch alarm fires, it triggers an immediate rollback to the last known-good configuration."
},
{
"answer": "AppConfig immediately rolls back to the previous known-good configuration version.",
"isCorrect": true,
"explanation": "This is the core safety mechanism of AppConfig: associating CloudWatch alarms with a deployment ensures automatic rollback if any alarm fires, with no human intervention required."
},
{
"answer": "AppConfig sends an SNS notification and waits for a manual approval to roll back.",
"isCorrect": false,
"explanation": "AppConfig's rollback triggered by a CloudWatch alarm is fully automatic and does not require manual approval."
},
{
"answer": "The deployment completes, and a rollback must be initiated manually from the console.",
"isCorrect": false,
"explanation": "When a CloudWatch alarm is associated with an AppConfig deployment, the rollback is automatic upon alarm firing — the deployment does not complete normally."
}
]
},
{
"question": "Before deploying a new configuration version, a team wants to ensure the JSON structure is valid and that a specific field contains a value between 0 and 100. Which combination of AppConfig validators should they use?",
"answers": [
{
"answer": "JSON Schema validator only",
"isCorrect": false,
"explanation": "A JSON Schema validator can check structure and types, but enforcing that a numeric value falls within a specific range (0–100) requires custom logic better handled by a Lambda validator."
},
{
"answer": "Lambda validator only",
"isCorrect": false,
"explanation": "A Lambda validator can perform any custom logic, but combining it with a JSON Schema validator provides an additional structural safety net before custom logic runs."
},
{
"answer": "JSON Schema validator and Lambda validator",
"isCorrect": true,
"explanation": "The JSON Schema validator catches structural errors (missing keys, wrong types), while the Lambda validator applies custom business logic (e.g., range checks). Using both provides layered validation before deployment."
},
{
"answer": "CloudWatch alarm and JSON Schema validator",
"isCorrect": false,
"explanation": "CloudWatch alarms handle post-deployment rollback, not pre-deployment validation. Validation is done via JSON Schema and/or Lambda validators."
}
]
},
{
"question": "A high-throughput application retrieves feature flags from AWS AppConfig on every incoming request. A developer is concerned about latency and API costs. What is the recommended solution?",
"answers": [
{
"answer": "Cache the configuration value in Amazon ElastiCache and refresh it every minute.",
"isCorrect": false,
"explanation": "While ElastiCache can cache data, it adds infrastructure complexity. The AppConfig Agent is the purpose-built, simpler solution for local caching without network overhead."
},
{
"answer": "Use the AppConfig Agent as a sidecar, which caches the configuration locally and serves it via a local HTTP endpoint.",
"isCorrect": true,
"explanation": "The AppConfig Agent runs as a sidecar (Lambda extension or container agent), polls AppConfig in the background, caches the config in memory, and exposes it at localhost:2772 — providing sub-millisecond reads for high-throughput services."
},
{
"answer": "Call the AppConfig API directly but use connection pooling to reduce overhead.",
"isCorrect": false,
"explanation": "Calling the AppConfig API directly on every request still incurs network latency and API costs. The AppConfig Agent is specifically designed to solve this by handling polling and caching locally."
},
{
"answer": "Store the configuration in an environment variable and restart the application when it changes.",
"isCorrect": false,
"explanation": "Restarting the application to pick up configuration changes defeats the purpose of AppConfig, which is to change config without redeployment or restarts."
}
]
},
{
"question": "How does an application retrieve a configuration value when using the AppConfig Agent?",
"answers": [
{
"answer": "By calling the AWS AppConfig API endpoint directly using the AWS SDK.",
"isCorrect": false,
"explanation": "When using the AppConfig Agent, the application does not call the AWS API directly. The agent handles that communication in the background."
},
{
"answer": "By making an HTTP GET request to localhost:2772 with the application, environment, and configuration profile in the path.",
"isCorrect": true,
"explanation": "The AppConfig Agent exposes a local HTTP server at localhost:2772. Applications call it with a path like /applications/{app}/environments/{env}/configurations/{profile} and receive the cached configuration instantly."
},
{
"answer": "By reading a local file written to disk by the AppConfig Agent.",
"isCorrect": false,
"explanation": "The AppConfig Agent serves configuration over a local HTTP endpoint (localhost:2772), not via a file on disk."
},
{
"answer": "By subscribing to an SNS topic that the AppConfig Agent publishes updates to.",
"isCorrect": false,
"explanation": "The AppConfig Agent does not use SNS. It serves configuration via a local HTTP endpoint that the application polls directly."
}
]
},
{
"question": "A developer is setting up AWS AppConfig for the first time. They want the simplest possible setup where configuration data is versioned automatically without relying on external storage. Which configuration source should they choose?",
"answers": [
{
"answer": "SSM Parameter Store",
"isCorrect": false,
"explanation": "SSM Parameter Store is a valid source, but it requires parameters to already exist there. It is not the simplest option for a greenfield setup."
},
{
"answer": "Amazon S3",
"isCorrect": false,
"explanation": "S3 is a valid source when config already lives there, but it requires managing a separate bucket and is not the simplest default for new setups."
},
{
"answer": "Hosted configuration",
"isCorrect": true,
"explanation": "Hosted configuration stores data directly in AppConfig with automatic versioning. It is the recommended default for new use cases and requires no external storage setup."
},
{
"answer": "SSM Document",
"isCorrect": false,
"explanation": "SSM Documents are a valid but more complex source, typically used when configuration already exists as a Systems Manager document."
}
]
},
{
"question": "In AWS AppConfig, what is the purpose of an 'Environment'?",
"answers": [
{
"answer": "It defines the source location of the configuration data (e.g., S3 or SSM).",
"isCorrect": false,
"explanation": "The source of configuration data is defined in the configuration profile, not the environment."
},
{
"answer": "It is a deployment target within an application, such as prod, staging, or dev, each with its own deployment history and rollback state.",
"isCorrect": true,
"explanation": "An AppConfig Environment represents a deployment target (e.g., prod, staging). Each environment maintains independent deployment history and rollback state, allowing configurations to be deployed separately per environment."
},
{
"answer": "It is a container that groups multiple AppConfig applications together.",
"isCorrect": false,
"explanation": "The Application is the top-level grouping container in AppConfig. The Environment exists within an Application as a deployment target."
},
{
"answer": "It controls which IAM roles can access the configuration data.",
"isCorrect": false,
"explanation": "IAM access control is managed through IAM policies, not AppConfig Environments."
}
]
},
{
"question": "A team uses AWS AppConfig with a Linear deployment strategy to roll out a new feature flag. What distinguishes a Linear strategy from an AllAtOnce strategy?",
"answers": [
{
"answer": "Linear deployments validate the configuration before starting; AllAtOnce does not.",
"isCorrect": false,
"explanation": "Both strategies run validators before deployment begins. The distinction is in how the configuration is rolled out to clients, not in validation behavior."
},
{
"answer": "Linear releases the configuration to an increasing percentage of clients at a fixed rate over time, while AllAtOnce delivers it to all clients immediately.",
"isCorrect": true,
"explanation": "AllAtOnce pushes the new config to every client at once. Linear incrementally exposes the config (e.g., 10% every 5 minutes), allowing time to detect issues before full rollout."
},
{
"answer": "Linear requires a CloudWatch alarm; AllAtOnce does not.",
"isCorrect": false,
"explanation": "CloudWatch alarm integration is optional for both strategies. It is not a requirement specific to Linear deployments."
},
{
"answer": "AllAtOnce supports rollback; Linear does not.",
"isCorrect": false,
"explanation": "Both strategies support rollback when a CloudWatch alarm is associated. Rollback capability is not limited to one strategy type."
}
]
},
{
"question": "Which of the following statements about AppConfig validators is correct? (Select TWO)",
"answers": [
{
"answer": "Validators run automatically whenever a deployment is started.",
"isCorrect": true,
"explanation": "AppConfig automatically invokes all configured validators at the start of a deployment. If any validator fails, the deployment is blocked before it reaches any client."
},
{
"answer": "A Lambda validator can enforce custom business rules, such as ensuring a numeric value falls within a specific range.",
"isCorrect": true,
"explanation": "Lambda validators execute arbitrary code, making them suitable for custom logic like range checks, cross-field validation, or calling external APIs."
},
{
"answer": "Validators are only available for configurations stored in S3.",
"isCorrect": false,
"explanation": "Validators can be applied to any configuration profile regardless of the storage source (hosted, S3, SSM Parameter Store, etc.)."
},
{
"answer": "A JSON Schema validator can invoke a Lambda function to check the schema.",
"isCorrect": false,
"explanation": "These are two distinct validator types. A JSON Schema validator checks structure against a provided schema; a Lambda validator invokes a Lambda function for custom logic. They do not combine."
}
]
},
{
"question": "A developer needs to change an application's timeout value from 30 seconds to 60 seconds across a fleet of containers. They want to avoid redeploying the containers. Which approach using AWS AppConfig achieves this?",
"answers": [
{
"answer": "Update the timeout in the application's environment variables and trigger an ECS service update.",
"isCorrect": false,
"explanation": "Updating environment variables requires redeploying the containers, which is exactly what the team wants to avoid."
},
{
"answer": "Update the configuration profile in AppConfig and deploy it to the target environment; the AppConfig Agent on each container will pick up the new value without redeployment.",
"isCorrect": true,
"explanation": "AppConfig is designed to deliver configuration changes independently of code deployments. The AppConfig Agent polls for updates and serves the new value to the application via the local HTTP endpoint, with no container restart required."
},
{
"answer": "Push the new timeout value to an SQS queue; each container reads from the queue and updates its in-memory value.",
"isCorrect": false,
"explanation": "While this could technically work, it is not a recommended pattern and requires custom implementation. AppConfig with the AppConfig Agent provides this capability natively."
},
{
"answer": "Store the timeout in AWS Secrets Manager and rotate the secret to trigger the update.",
"isCorrect": false,
"explanation": "Secrets Manager is for rotating credentials, not for managing application configuration like timeout values. Rotation also does not guarantee immediate pickup by running containers."
}
]
}
]
{{< /qcm >}}