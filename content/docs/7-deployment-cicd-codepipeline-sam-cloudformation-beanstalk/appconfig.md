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