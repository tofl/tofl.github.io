---
title: "SAM CLI Configuration File (samconfig.toml): Guided Deploy and Parameter Persistence"
---

## SAM CLI Configuration File (samconfig.toml): Guided Deploy and Parameter Persistence

When you're deploying serverless applications with AWS SAM, manually entering the same deployment parameters over and over again becomes tedious and error-prone. The `samconfig.toml` file solves this problem by persisting your deployment configuration, allowing you to run `sam deploy` with a single command once you've gone through the guided setup process. This file is central to how SAM handles both interactive and automated deployments, and understanding it deeply will make you a more efficient developer and help you implement consistent deployment practices across teams.

### Understanding the samconfig.toml File

The `samconfig.toml` file is a configuration file that the SAM CLI creates and uses to store deployment parameters in TOML format. When you run `sam deploy --guided`, SAM prompts you for various deployment details—stack name, AWS region, parameter values, capabilities, and so on—and then persists these answers to this file. On subsequent deployments, `sam deploy` reads from this file by default, eliminating the need to re-answer the same questions.

Think of `samconfig.toml` as your deployment playbook. It captures all the decisions you made during your first guided deployment and allows you to replay them automatically. This is particularly powerful in CI/CD pipelines where you want deployments to be reproducible and consistent without human intervention.

The file lives at the root of your SAM project directory, typically alongside your `template.yaml` file. It's a plain text file that follows the TOML (Tom's Obvious, Minimal Language) syntax, which is human-readable and easy to edit manually if needed.

### The Structure of samconfig.toml

Let's examine what a typical `samconfig.toml` looks like. After running `sam deploy --guided`, you'll see something like this:

```toml
version = 1
[default]
[default.deploy]
[default.deploy.parameters]
stack_name = "my-app-stack"
s3_bucket = "aws-sam-cli-managed-default-samclibucket-1a2b3c4d5e6f"
s3_prefix = "my-app-stack"
region = "us-east-1"
confirm_changeset = false
capabilities = "CAPABILITY_IAM"
parameter_overrides = "Environment=prod"
```

At the top, `version = 1` indicates the configuration file format version. This allows SAM to evolve the file structure while maintaining backward compatibility with older configurations.

The configuration is organized into named profiles, with `default` being the one created automatically. Each profile contains a `[deploy]` section under which you'll find a `[parameters]` subsection. This hierarchical structure makes it easy to support multiple deployment environments, which we'll explore in detail later.

The actual configuration parameters are fairly self-explanatory. The `stack_name` is the CloudFormation stack name that will be created or updated. The `s3_bucket` and `s3_prefix` are where SAM will upload your packaged application code. The `region` specifies your AWS region, while `confirm_changeset` controls whether SAM will wait for your approval before applying changes. The `capabilities` parameter tells CloudFormation what permissions SAM has to create resources, and `parameter_overrides` passes values to your SAM template parameters.

### How `sam deploy --guided` Populates the File

Running `sam deploy --guided` initiates an interactive wizard that walks you through each deployment parameter. SAM asks questions in a logical order, guiding you through the most important decisions first. Here's what a typical guided deployment flow looks like:

When you run the command, SAM first checks whether a `samconfig.toml` file already exists. If it does, it shows you the previously saved values and gives you the option to accept them or change them. If the file doesn't exist, SAM creates it with default values based on your environment.

For the stack name, SAM asks what you'd like to call your CloudFormation stack. This is the identifier that CloudFormation uses to manage your resources. SAM suggests a reasonable default based on your project name.

For the S3 bucket, SAM can either use an existing bucket you specify or create a managed default bucket if you allow it. When SAM manages the bucket, it creates one with a name like `aws-sam-cli-managed-default-samclibucket-[random-string]`. This bucket stores the packaged Lambda function code and any layer artifacts. Using a SAM-managed bucket is convenient for getting started, but in production environments, many teams prefer to use their own organization-controlled buckets.

For the region, SAM prompts you to choose where your stack will be deployed. This is typically based on where your application's users are located or where your other infrastructure lives.

SAM then asks about capabilities. When you deploy a SAM template that creates IAM roles, you must acknowledge this by confirming `CAPABILITY_IAM` or `CAPABILITY_NAMED_IAM`. SAM will save your choice so you don't have to confirm it every time.

Finally, SAM asks whether you want it to confirm any changes before applying them. This is a safety mechanism—if you say yes, SAM will show you the changeset before deploying and wait for your approval. For automated deployments, you typically set this to false.

Once you've answered all the questions, SAM writes these values to `samconfig.toml` and immediately proceeds with the deployment. Your answers are now saved and will be reused on future deployments.

### Manual Editing and Advanced Configuration

While the guided deployment handles the common use cases, you'll often need to manually edit `samconfig.toml` to fine-tune your configuration or add settings that the interactive wizard doesn't cover.

One common reason to edit manually is to add or modify `parameter_overrides`. These are values that get passed directly to your SAM template. For example, if your template expects an `Environment` parameter, you'd include it like this:

```toml
parameter_overrides = "Environment=production Timeout=60"
```

Multiple parameters are space-separated. If your parameter values contain spaces, you'll need to quote them:

```toml
parameter_overrides = "Environment=production Description=\"My application\""
```

Another advanced use case is managing tags. You can add a `tags` parameter to apply AWS tags to your deployed stack:

```toml
tags = "Environment=prod Owner=engineering CostCenter=12345"
```

Tags are useful for cost allocation, automation, and governance. They're automatically applied to all resources created by your CloudFormation stack.

You might also want to adjust the `s3_prefix`. This is the path within your S3 bucket where artifacts are stored. Changing this allows you to organize artifacts by application, environment, or version:

```toml
s3_prefix = "my-app-stack/v2.1.0"
```

The `image_repositories` parameter becomes relevant if you're using container images instead of zip-based Lambda functions:

```toml
image_repositories = ["MyFunction=123456789012.dkr.ecr.us-east-1.amazonaws.com/my-app:latest"]
```

When you manually edit the file, you need to maintain valid TOML syntax. Strings should be quoted, boolean values should be lowercase (true or false), and the hierarchy of section headers must be correct. If the syntax is invalid, SAM will fail with a parse error when you run `sam deploy`.

### Parameter Precedence: CLI Flags vs. Saved Configuration

Understanding how SAM handles parameter precedence is crucial for advanced deployment workflows. When you run `sam deploy`, parameters can come from multiple sources, and SAM follows a clear precedence order:

The highest priority goes to command-line flags. If you explicitly pass `--region us-west-2` on the command line, that value will be used regardless of what's saved in `samconfig.toml`. This is intentional—it allows you to override saved settings on a case-by-case basis.

Next in precedence are environment variables. SAM respects certain environment variables like `AWS_REGION` and `AWS_PROFILE`, which is useful in CI/CD pipelines where you might set these globally.

Finally, if neither a CLI flag nor an environment variable is provided, SAM falls back to the values in `samconfig.toml`. If the file doesn't have a value for a required parameter, SAM will either prompt you interactively or fail, depending on whether you're running in guided mode.

This precedence model gives you flexibility. In a CI/CD pipeline, you might save the common configuration to `samconfig.toml` but override the stack name and region using environment variables to deploy to different environments from the same codebase.

For example, you might have a `samconfig.toml` like this:

```toml
[default.deploy.parameters]
stack_name = "my-app-stack"
s3_bucket = "my-artifacts-bucket"
region = "us-east-1"
```

And then in your CI/CD pipeline, you could deploy to different regions like this:

```bash
# Deploy to staging
AWS_REGION=us-west-2 sam deploy

# Deploy to production
AWS_REGION=eu-west-1 sam deploy
```

The stack name and S3 bucket come from `samconfig.toml`, but the region is overridden by the environment variable. This pattern is especially useful when you want consistency but need flexibility for certain parameters.

### Managing Multiple Deployment Profiles

Real-world applications typically need multiple deployment configurations: one for development, one for staging, and one for production. SAM handles this elegantly through named profiles.

A profile in `samconfig.toml` is essentially a named set of deployment configurations. By default, SAM uses the `default` profile, but you can create as many additional profiles as you need:

```toml
version = 1

[default]
[default.deploy.parameters]
stack_name = "my-app-dev"
s3_bucket = "my-artifacts-bucket"
region = "us-east-1"
capabilities = "CAPABILITY_IAM"

[staging]
[staging.deploy.parameters]
stack_name = "my-app-staging"
s3_bucket = "my-artifacts-bucket"
region = "us-east-1"
capabilities = "CAPABILITY_IAM"
parameter_overrides = "Environment=staging"

[production]
[production.deploy.parameters]
stack_name = "my-app-prod"
s3_bucket = "my-artifacts-bucket"
region = "us-east-1"
capabilities = "CAPABILITY_IAM CAPABILITY_NAMED_IAM"
parameter_overrides = "Environment=production"
confirm_changeset = true
```

To deploy using a specific profile, you use the `--config-env` flag:

```bash
# Deploy to staging
sam deploy --config-env staging

# Deploy to production
sam deploy --config-env production
```

Each profile is completely independent. You can have different stacks, regions, parameter values, and even different S3 buckets per profile. This allows you to maintain consistent configurations for each environment without switching files or manually editing parameters between deployments.

Creating these profiles manually is straightforward—just copy the `[profile_name]` section and adjust the parameters as needed. Alternatively, you can let SAM create a new profile by running `sam deploy --guided --config-env staging` (if the staging profile doesn't already exist, you'll go through the guided wizard, and the results will be saved under that profile name).

### Version Control Considerations and Sensitive Data

One of the advantages of `samconfig.toml` is that it can be version-controlled alongside your code, ensuring that your deployment configuration stays synchronized with your application code. However, you need to be thoughtful about what you commit to version control.

It's generally safe to commit the basic deployment structure—stack names, regions, and capability flags. These are non-sensitive configuration details that your team needs to know about and that should be consistent across all developers.

However, you should be cautious about storing sensitive information in version control. AWS account IDs, for instance, are sometimes considered sensitive (though many organizations accept them being public). API keys, database passwords, or other credentials should never be in `samconfig.toml` or any version-controlled file.

A common pattern is to commit `samconfig.toml` but use a `.gitignore` file to exclude a local override file:

```
# .gitignore
samconfig.local.toml
```

You can then create a `samconfig.local.toml` file with environment-specific or sensitive values:

```toml
[production.deploy.parameters]
parameter_overrides = "DatabasePassword=super-secret-password"
```

When you run `sam deploy --config-env production`, you can merge configurations from both files. However, SAM doesn't natively support this—you'd need to handle it in your deployment script or use parameter store references instead.

A better approach is to avoid storing sensitive values in the configuration file altogether. Instead, use AWS Systems Manager Parameter Store or Secrets Manager to store sensitive data, and have your SAM template reference them. This keeps secrets out of your codebase entirely while still allowing your deployment configuration to be version-controlled.

For example, in your SAM template, you might reference a secret like this:

```yaml
Parameters:
  DatabasePassword:
    Type: AWS::SecretsManager::Secret::SecretString
    Default: !Sub '{{resolve:secretsmanager:my-db-password}}'
```

Then your `samconfig.toml` doesn't need to contain the password at all—it's retrieved from Secrets Manager at deployment time.

### Practical Deployment Workflows

Let's walk through how `samconfig.toml` fits into real-world deployment scenarios.

For a developer working locally, the workflow is straightforward. You run `sam deploy --guided` once, answer the prompts, and then for every subsequent deployment during development, you just run `sam deploy`. SAM reads your configuration from the file and deploys without any interactive prompts. If you need to change something—maybe you want to deploy to a different region—you can either edit `samconfig.toml` directly or use command-line overrides like `sam deploy --region eu-west-1`.

In a CI/CD pipeline, you might check `samconfig.toml` into version control with environment-specific profiles for staging and production. Your pipeline script then does something like:

```bash
#!/bin/bash
if [ "$ENVIRONMENT" = "staging" ]; then
  sam deploy --config-env staging
elif [ "$ENVIRONMENT" = "production" ]; then
  sam deploy --config-env production
fi
```

The pipeline doesn't need to pass any parameters interactively—it just runs `sam deploy` with the appropriate profile, and everything flows from the saved configuration.

For teams managing multiple applications, you might commit a template `samconfig.toml.example` that shows the expected structure, and have developers copy and customize it locally without committing their personal copy. This provides documentation about how the deployment should be configured without forcing everyone to have identical configurations.

Another pattern is to use environment variables in your CI/CD system to override specific parameters. For example, in AWS CodePipeline or GitHub Actions, you might set:

```bash
export AWS_ACCOUNT_ID="123456789012"
export AWS_REGION="us-east-1"
```

And then in your deployment script, reference these:

```bash
sam deploy --region $AWS_REGION
```

The CI/CD system manages the sensitive values (like the account ID), and your code just uses them. Meanwhile, `samconfig.toml` captures the common, non-sensitive configuration that applies across all deployments.

### Troubleshooting Common Issues

When working with `samconfig.toml`, you might encounter a few common issues.

If SAM complains about TOML syntax errors, double-check your file format. TOML is strict about quotes and structure. Boolean values must be `true` or `false` (lowercase), and strings must be quoted. Online TOML validators can help if you're unsure.

If you see "Parameter not found" errors during deployment, it might be that your `parameter_overrides` reference a parameter that doesn't exist in your template. Make sure the parameter names match exactly (they're case-sensitive) and that they're actually defined in your `template.yaml`.

If a profile isn't being used despite specifying `--config-env`, verify that the profile section exists in your `samconfig.toml`. The profile names are case-sensitive, and the section headers must follow the TOML hierarchy exactly.

If you're getting prompts even though you have values saved, you might be running `sam deploy --guided` instead of just `sam deploy`. The `--guided` flag always triggers the wizard. Without it, SAM uses the saved configuration non-interactively.

### Conclusion

The `samconfig.toml` file is a small but powerful tool in the SAM ecosystem. It transforms the deployment experience from a repetitive, interactive process into a streamlined, configuration-driven workflow. By understanding how to structure it, when to edit it manually, and how it interacts with command-line flags and environment variables, you gain the ability to implement consistent, reproducible deployments across development, staging, and production environments.

The key takeaway is that `samconfig.toml` isn't just a convenience—it's foundational to building professional, scalable deployment practices. Whether you're deploying applications locally during development or orchestrating complex multi-environment deployments in a CI/CD pipeline, a well-configured `samconfig.toml` ensures that your deployment parameters are explicit, version-controlled (where appropriate), and reusable. As you continue working with AWS SAM, you'll find that investing time upfront to properly structure your configuration files pays dividends in team productivity and deployment reliability.
