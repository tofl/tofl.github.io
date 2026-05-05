---
title: "Elastic Beanstalk Environment Properties and Cross-Environment Replication with Saved Configurations"
---

## Elastic Beanstalk Environment Properties and Cross-Environment Replication with Saved Configurations

Creating consistent, reliable environments across your deployment pipeline is one of those challenges that seems simple until you're managing dozens of applications across staging, testing, and production. You configure load balancing settings in staging, tweak auto-scaling rules in production, set environment variables in development—and three months later, you realize your environments have drifted so far apart they might as well be different applications. AWS Elastic Beanstalk's saved configurations feature elegantly solves this problem by letting you capture a complete snapshot of your environment's settings and reuse that configuration across teams and new deployments.

This article explores how saved configurations work, how they help enforce infrastructure consistency, and the practical patterns for leveraging them in real-world scenarios. Whether you're building a system that demands identical staging and production setups or managing multiple applications with shared standards, understanding this feature transforms how you think about environment management.

### Understanding Elastic Beanstalk Saved Configurations

A saved configuration in Elastic Beanstalk is a reusable template that captures the complete state of an environment's configuration at a point in time. Think of it as a snapshot of everything that makes your environment what it is: the instance type and capacity, auto-scaling policies, load balancer setup, environment variables, security groups, database connection strings, and dozens of other settings spread across multiple configuration namespaces.

The power of saved configurations lies in their portability. Once you've invested time tuning an environment to meet your exact needs—establishing the right capacity for your typical load, configuring health checks for your specific application, setting up environment-specific database credentials—you can freeze that configuration and use it as a blueprint for creating new environments. This eliminates the tedious manual re-entry of settings and, more importantly, removes the human error that creeps in when developers manually recreate environments.

What makes this different from simply noting down your settings is that Elastic Beanstalk manages the entire configuration in a structured, versioned way. Each saved configuration is stored and versioned in your AWS account, accessible across your organization, and can be applied to new environments with a single API call or CLI command. It's the infrastructure equivalent of having a perfectly written recipe rather than a checklist of ingredients.

### How Saved Configurations Capture Environment State

When you create a saved configuration from an existing environment, Elastic Beanstalk extracts configuration settings from several distinct namespaces. Understanding what gets captured helps you appreciate what you're actually preserving.

**Compute and capacity settings** form the foundation. This includes your environment's instance type (whether you're running `t3.small` or `m5.xlarge`), the minimum and maximum number of instances, the preferred availability zone configuration, and whether you're using spot instances or on-demand. These settings directly impact your cost and performance characteristics.

**Auto-scaling configuration** captures how your environment responds to load. This includes target CPU utilization thresholds, scaling adjustment increments, cooldown periods between scaling events, and metric alarms. If you've spent weeks tuning your application to scale smoothly under production load, this is the configuration you want to preserve and apply to your staging environment.

**Load balancer configuration** includes the type of load balancer (Application Load Balancer or Network Load Balancer), listener ports and protocols, health check settings specific to your application, and stickiness policies if your application requires them. These settings are critical for ensuring your application remains accessible and performant.

**Environment variables and secrets** are stored, though I'll note that truly sensitive data like database passwords might require separate consideration depending on your security practices. Standard environment variables that control application behavior are captured and replicated.

**VPC and networking configuration** preserves which VPC your environment runs in, subnets, security groups, and whether your instances have public IP addresses. This ensures that a replicated environment lands in the correct network topology.

**Monitoring and logging configuration** captures CloudWatch metrics, log streaming settings, and enhanced health reporting configuration. If you've configured specific log groups or metrics that matter to your application, these travel with your configuration.

The configuration doesn't capture the actual application code or version—that's handled separately through application versions. It also doesn't capture the current state of your databases or data persistence layers, which is intentional; you manage those independently. But everything else that shapes how your environment runs is there.

### Creating and Managing Saved Configurations

Let's walk through the practical process of creating a saved configuration from an existing environment. The most direct approach uses the AWS Management Console, but the CLI provides more scriptability and is valuable for automation.

If you already have an environment that's properly configured—let's say a staging environment with exactly the right instance types, scaling policies, and environment variables—you can capture it as a saved configuration. Using the console, you navigate to your Elastic Beanstalk application, select the environment, and choose the option to create a configuration template. Elastic Beanstalk reads the current environment settings and stores them as a named template.

Via the CLI, the command is similarly straightforward:

```bash
aws elasticbeanstalk create-configuration-template \
  --application-name my-application \
  --template-name staging-config-v2 \
  --environment-id e-abc123def456 \
  --region us-east-1
```

This command tells Elastic Beanstalk to snapshot the configuration of the environment with ID `e-abc123def456` and store it as a named template called `staging-config-v2` within the `my-application` application. The template is immediately available for use.

You can also create configuration templates from scratch without an existing environment as a source. This is useful if you want to version configurations independently or create a baseline before any environment exists:

```bash
aws elasticbeanstalk create-configuration-template \
  --application-name my-application \
  --template-name production-baseline \
  --option-settings \
    Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=m5.large \
    Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=2 \
    Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=10
```

Here, you're specifying configuration options directly. Each option is placed within a namespace that organizes related settings. The `aws:autoscaling:launchconfiguration` namespace handles instance-level details, while `aws:autoscaling:asg` contains Auto Scaling Group settings.

Managing multiple saved configurations requires a versioning strategy. Rather than overwriting a configuration template, you typically create new versions with descriptive names: `staging-config-v1`, `staging-config-v2`, and so on. This allows you to roll back if a configuration introduces problems or to A/B test different environment setups. You can list all templates for an application with:

```bash
aws elasticbeanstalk describe-configuration-templates \
  --application-name my-application
```

This command returns all saved configurations associated with your application, including metadata about when each was created and which environment (if any) it was sourced from.

### Replicating Environments with Saved Configurations

The real value of saved configurations emerges when you use them to create new environments. Rather than manually specifying dozens of settings, you reference your saved configuration and let Elastic Beanstalk handle the rest.

Creating a new environment from a saved configuration is elegantly simple:

```bash
aws elasticbeanstalk create-environment \
  --application-name my-application \
  --environment-name production-env \
  --template-name staging-config-v2 \
  --version-label app-v1.2.3
```

This command creates a brand-new environment called `production-env` using the configuration template `staging-config-v2`. The `--version-label` parameter specifies which version of your application code to deploy. The environment inherits all the capacity, scaling, networking, and environment variable settings from the template but runs with fresh instances and infrastructure.

The distinction between a configuration template and an application version is worth emphasizing. The template captures the *how* of your environment—how it's sized, scaled, and configured. The application version specifies the *what*—which code and dependencies get deployed. By separating these concerns, you can update your application code without changing your infrastructure configuration, or vice versa.

When you create the environment, Elastic Beanstalk launches the infrastructure according to the template's specifications. If the template specifies a minimum of two instances and a maximum of ten, your new environment starts with two instances. If the template configures environment variables for database connection strings, those appear in your new environment automatically. The process typically takes three to five minutes, depending on instance startup time and health checks.

### Use Cases: Enforcing Consistency Across Deployment Stages

The power of saved configurations shines in several practical scenarios.

**Staging and production parity** is perhaps the most compelling use case. In many organizations, developers have an understanding of how staging "should" match production, but without a mechanism to enforce that matching, environments drift. A developer tweaks auto-scaling settings in production to handle a traffic spike, but staging never gets the update. Another team member adds an environment variable to staging to debug an issue and forgets to remove it before pushing to production. Over time, the environments become subtly different, and you end up troubleshooting in one environment only to discover the problem behaves differently in another.

By creating a saved configuration from your production environment and explicitly using that same configuration for staging, you eliminate this drift. When you want to update both environments' capacity or scaling policies, you create a new version of the configuration and roll it out to both. The configuration becomes the source of truth for what staging and production should look like.

**Rapid environment provisioning for testing** is another valuable pattern. Imagine you're testing a new feature that requires different auto-scaling behavior. Rather than manually configuring a test environment, you create a test configuration template and spin up five test environments from that template. Each one starts identically configured, allowing you to test different code versions or application configurations against the same infrastructure. When testing is complete, you delete the environments but keep the template for future use.

**Team standardization** becomes feasible when configurations are accessible across your organization. Suppose your organization has established standards for production environments: minimum two instances, maximum fifty, specific instance types, particular security group configurations. You can create a saved configuration that embodies these standards and require that all production environments derive from this template. New teams joining your organization can immediately provision environments that meet corporate standards without needing to learn all the details. Configuration templates become a form of infrastructure-as-code that your entire organization can use.

**Multi-region deployments** benefit significantly from saved configurations. If your application needs to run in both `us-east-1` and `eu-west-1`, you can create a configuration template in one region and use it to provision identically configured environments in another region. The regions themselves don't change—you're still running in the same VPC and subnets—but the configuration consistency ensures your application behaves the same way regardless of geography.

### Advanced Configuration Patterns

Saved configurations support option overrides, allowing you to use a template as a base and customize specific settings for particular environments. This is useful when you have a common baseline but need slight variations across environments.

For instance, you might create a base configuration template with your standard settings:

```bash
aws elasticbeanstalk create-configuration-template \
  --application-name my-application \
  --template-name base-config \
  --option-settings \
    Namespace=aws:autoscaling:launchconfiguration,OptionName=InstanceType,Value=t3.medium \
    Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=1 \
    Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=5 \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=ENVIRONMENT,Value=base
```

Then, when creating an environment, you can override specific options:

```bash
aws elasticbeanstalk create-environment \
  --application-name my-application \
  --environment-name production-env \
  --template-name base-config \
  --option-settings \
    Namespace=aws:autoscaling:asg,OptionName=MinSize,Value=3 \
    Namespace=aws:autoscaling:asg,OptionName=MaxSize,Value=20 \
    Namespace=aws:elasticbeanstalk:application:environment,OptionName=ENVIRONMENT,Value=production
```

The new environment inherits everything from `base-config` but uses three to twenty instances instead of one to five, and sets the environment variable to `production` instead of `base`. This pattern allows you to maintain a core configuration while varying settings for specific contexts.

Configuration files (`.ebextensions`) provide even deeper customization. These YAML or JSON files live in your application bundle and can extend or override configuration templates. A configuration file might add custom CloudWatch alarms, install additional packages, or run initialization scripts. When you deploy an application version, the configuration files are processed alongside the saved configuration template, allowing you to layer customization.

### Updating and Versioning Configurations

Saved configurations aren't immutable; you can update them. However, Elastic Beanstalk treats configuration updates carefully to avoid unexpected changes to existing environments.

When you update a saved configuration template, that change applies only to *new* environments created from the template going forward. Existing environments continue running with their current configuration unless you explicitly update them. This is a safety mechanism—you don't want a template change to unexpectedly modify production.

If you want to apply a configuration update to an existing environment, you have two options. The first is to update the environment's configuration directly, which bypasses the template. The second is to use the template but explicitly request an environment update. Both approaches trigger a configuration change that may require instance replacement or a rolling update depending on which settings change.

A robust versioning strategy helps manage this complexity. Rather than updating a template in place, create new versions: `production-config-v1`, `production-config-v2`, etc. This gives you a clear history of configuration changes and makes it easy to roll back if needed. You can compare versions, understand what changed, and make informed decisions about which version to use for new environments.

### Cost Implications of Saved Configurations

Here's an important clarification: saved configurations themselves have no direct cost. Storing a configuration template in Elastic Beanstalk incurs no charges. What costs money is the *infrastructure* that runs based on those configurations.

However, saved configurations indirectly influence cost through consistency and efficiency. By ensuring your environments are properly sized—not over-provisioned with unnecessary instances or under-provisioned and suffering performance issues—you optimize your infrastructure costs. If a saved configuration captures the lean, efficient setup you've tuned for your production environment, applying that same configuration everywhere prevents other environments from accidentally over-consuming resources.

Additionally, saved configurations reduce operational overhead. Rather than spending hours manually configuring environments or scripting complex setup procedures, you provision environments from templates quickly. This means you're less likely to leave temporary test environments running indefinitely, reducing waste.

The cost story also touches on instance type choices. When you capture a production environment's instance type in a saved configuration and apply it to staging, you're ensuring staging runs the same instance type at the same cost. If your organization has committed to certain instance types for cost optimization (perhaps reserved instances), saved configurations help you enforce those choices across your environment inventory.

### Troubleshooting Configuration Issues

When environments created from saved configurations don't behave as expected, the issue often traces to missing or conflicting option settings.

Elastic Beanstalk resolves configuration from multiple sources in a specific order: environment-specific settings override option settings defined in `.ebextensions` files, which override the saved configuration template. If you've created a template with specific settings but a `.ebextensions` file in your application bundle contradicts those settings, the `.ebextensions` file wins. Understanding this precedence helps you debug configuration discrepancies.

You can inspect the actual configuration of a running environment using:

```bash
aws elasticbeanstalk describe-configuration-settings \
  --application-name my-application \
  --environment-name production-env
```

This returns all option settings currently in effect for the environment. Comparing this output to your saved configuration template helps identify where configuration sources diverge.

Environment events provide another debugging tool. Elastic Beanstalk logs configuration updates, environment creation, and scaling events. Reviewing these events helps you understand what configuration changes actually took effect and whether they succeeded or failed. The console displays these events chronologically, and you can also query them via CLI:

```bash
aws elasticbeanstalk describe-events \
  --application-name my-application \
  --environment-name production-env \
  --max-records 20
```

### Best Practices for Configuration Management

Building a mature approach to saved configurations requires a few key practices.

**Name templates descriptively and version them consistently.** Rather than `config-v1`, use `prod-baseline-v1` or `staging-optimized-v2`. The extra context in the name makes it obvious what a configuration is for and helps prevent accidental use of the wrong template.

**Document the reasoning behind configuration choices.** While the template captures the *what*, documentation captures the *why*. If a particular auto-scaling threshold was chosen based on load testing data, document that. If an instance type was selected because it offers the best price-to-performance ratio for your workload, note it. Future you and your teammates will appreciate the context.

**Test configuration changes in non-production environments first.** Create a test environment from your proposed new configuration and validate that your application behaves correctly before applying it to production. This is especially important for changes affecting auto-scaling or load balancer behavior, which influence application availability.

**Use configuration templates as infrastructure-as-code.** Store configuration templates in version control. Rather than creating templates interactively through the console, script their creation using the CLI so that configuration changes are tracked, reviewed, and auditable.

**Separate concerns between templates and application configuration.** A saved configuration template should capture infrastructure-level decisions: compute capacity, scaling policies, networking. Application-level configuration—database connection strings, feature flags, logging levels—belongs in your application's configuration management system or environment variables managed separately. This separation makes it easier to reason about what each system controls.

### Conclusion

Elastic Beanstalk's saved configurations transform environment management from a tedious, error-prone manual process into a repeatable, versionable, and shareable practice. By capturing the complete state of a properly tuned environment and using that configuration to provision new environments, you enforce consistency across your deployment pipeline, reduce operational toil, and enable rapid scaling of your infrastructure.

The feature shines brightest when you adopt it as part of a broader infrastructure-as-code discipline. Rather than treating environment configuration as a one-time setup task, approach it as an ongoing practice of capturing, versioning, and intentionally propagating your infrastructure decisions. Whether you're ensuring your staging environment mirrors production, provisioning test environments for a new feature, or helping your organization scale its application infrastructure, saved configurations provide the tool to do it reliably and repeatably.
