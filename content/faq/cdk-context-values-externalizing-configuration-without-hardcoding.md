---
title: "CDK Context Values: Externalizing Configuration Without Hardcoding"
---

## CDK Context Values: Externalizing Configuration Without Hardcoding

When you first start building infrastructure with AWS CDK, there's a tempting shortcut: hardcode your configuration values directly into your construct code. That VPC CIDR block? Hardcode it. The AMI ID? Hardcode it. The environment-specific database size? You get the idea. But as soon as you deploy to a second environment—say, production—you're stuck either maintaining multiple code branches or doing risky find-and-replace operations before deployment. There has to be a better way, and fortunately, CDK provides an elegant solution through context values.

Context values are CDK's mechanism for externalizing configuration from your code, allowing you to parameterize your infrastructure stacks across different environments without modifying a single line of application code. Unlike hardcoding, and with some key differences from CloudFormation parameters, context values let you bake environment-specific settings into your synthesis process itself. This article will walk you through what context values are, how to use them effectively, and how to build robust multi-environment deployment pipelines that keep your code clean and your configurations organized.

### Understanding Context Values and Why They Matter

At their core, context values are key-value pairs that your CDK constructs can read during synthesis. When you synthesize a CDK app—that is, when you run `cdk synth` or `cdk deploy`—the CDK engine reads your construct code, but it also looks for context values that your code might reference. These values can come from several sources: your `cdk.json` configuration file, command-line flags, or even CloudFormation outputs from existing stacks.

The key insight here is timing. Context values are resolved *during synthesis*, not during CloudFormation deployment. This means the values are baked into the CloudFormation template before it ever reaches AWS. This is fundamentally different from CloudFormation parameters, which are resolved *during stack creation or update*. That distinction matters enormously for how you design your infrastructure code.

Consider a practical scenario: you're building a three-tier application that needs to run in both a development environment and a production environment. The development environment needs a small instance type (t3.micro) and a permissive security group, while production needs larger instances (m5.xlarge) with tighter security rules. With hardcoding, you'd have either two separate CDK apps or you'd manually edit your code before each deployment. With context values, you specify the instance type as a parameter, and your construct code reads that parameter at synthesis time, producing different CloudFormation templates for dev and prod without any code changes.

### Defining Context Values in cdk.json

The most straightforward way to define context values is through your project's `cdk.json` file. This file sits at the root of your CDK project and serves as the default configuration source for your synthesis process.

Let's say you're building a web server stack that needs different configurations for development and production. Here's what your `cdk.json` might look like:

```json
{
  "app": "python app.py",
  "context": {
    "environment": "dev",
    "instanceType": "t3.micro",
    "vpcCidr": "10.0.0.0/16",
    "enableEnhancedMonitoring": false,
    "amiId": "ami-0c55b159cbfafe1f0"
  }
}
```

Within your CDK application code, you access these values through the `node.tryGetContext()` method (or `node.getContext()` if you want an exception if the value is missing). Here's a simple example:

```python
from aws_cdk import aws_ec2 as ec2
from aws_cdk import core

class WebServerStack(core.Stack):
    def __init__(self, scope: core.Construct, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)
        
        # Read context values
        instance_type_str = self.node.try_get_context("instanceType") or "t3.micro"
        vpc_cidr = self.node.try_get_context("vpcCidr") or "10.0.0.0/16"
        environment = self.node.try_get_context("environment") or "dev"
        
        # Use the context values to configure your infrastructure
        vpc = ec2.Vpc(
            self, "Vpc",
            cidr=vpc_cidr,
        )
        
        instance = ec2.Instance(
            self, "WebServer",
            vpc=vpc,
            instance_type=ec2.InstanceType(instance_type_str),
            machine_image=ec2.AmazonLinuxImage(),
        )
```

The beauty of this approach is that your code is clean and straightforward. It doesn't contain a maze of if-statements checking which environment you're in. Instead, it simply reads the values it needs and uses them. The environment-specific logic lives entirely in the configuration layer, not the code layer.

### Using the --context CLI Flag for Dynamic Configuration

While `cdk.json` is excellent for default values, sometimes you need to override context values at deployment time without editing the file. This is where the `--context` (or `-c`) CLI flag comes in handy.

When you run a CDK command, you can pass context values directly:

```bash
cdk deploy --context instanceType=m5.xlarge --context environment=prod
```

This approach is particularly powerful when you're running deployments from a CI/CD pipeline. Rather than maintaining separate `cdk.json` files for each environment or editing the file before deployment, your pipeline can simply pass the appropriate context values as command-line arguments. This keeps your repository clean and your deployment logic explicit.

You can pass as many context flags as you need, and they'll override any values from `cdk.json`:

```bash
cdk deploy \
  --context environment=prod \
  --context instanceType=m5.xlarge \
  --context vpcCidr=10.100.0.0/16 \
  --context enableEnhancedMonitoring=true \
  --context amiId=ami-0123456789abcdef0
```

This CLI approach also works great for one-off testing or for operators who need to deploy infrastructure without touching the code repository. A platform team could have a standardized script that reads environment variables and converts them to context flags, abstracting away the CDK details from the end user.

### Context Values Versus CloudFormation Parameters

Before diving deeper, it's worth clarifying a common point of confusion: how context values differ from CloudFormation parameters, since both allow you to externalize configuration.

CloudFormation parameters are values that you specify when creating or updating a CloudFormation stack. They're passed to the AWS CloudFormation API and are stored as part of the stack's metadata. You can look at a stack's parameters in the AWS Console, and you can update parameters even after the stack is created (though this might require a stack update).

Context values, by contrast, are resolved during the CDK synthesis phase. Once the synthesis is complete, the values are baked into the CloudFormation template as literals. There's no way to change them without re-synthesizing and re-deploying. They don't exist as CloudFormation parameters unless you explicitly create them.

So which should you use? The rule of thumb is this: use context values for configuration that's fixed at deployment time and that you want to bake into your CloudFormation template. Use CloudFormation parameters (which you can expose through CDK's `CfnParameter` construct) if you need the ability to change the value without re-deployment, or if you want operators to be able to update the stack through the CloudFormation console.

In practice, most environment-specific configuration—instance types, CIDR blocks, AMI IDs—is a perfect fit for context values. Configuration that genuinely needs to be changeable after deployment, like a database password or a feature flag that gets updated weekly, might be better served by CloudFormation parameters or by storing those values in AWS Systems Manager Parameter Store or AWS Secrets Manager.

### Common Patterns for Environment-Specific Configuration

Now let's explore some real-world patterns for managing multiple environments with context values. The foundation of a solid multi-environment setup is organization: you need a clear strategy for how context values are named and structured.

One effective pattern is to nest your context values by environment. Rather than having flat keys like `devInstanceType` and `prodInstanceType`, you structure them hierarchically:

```json
{
  "app": "python app.py",
  "context": {
    "dev": {
      "instanceType": "t3.micro",
      "vpcCidr": "10.0.0.0/16",
      "databaseSize": "db.t3.small",
      "enableEnhancedMonitoring": false,
      "backupRetentionDays": 7
    },
    "prod": {
      "instanceType": "m5.xlarge",
      "vpcCidr": "10.100.0.0/16",
      "databaseSize": "db.r5.large",
      "enableEnhancedMonitoring": true,
      "backupRetentionDays": 30
    }
  }
}
```

Then in your code, you read the appropriate block based on the environment:

```python
class InfrastructureStack(core.Stack):
    def __init__(self, scope: core.Construct, id: str, **kwargs):
        super().__init__(scope, id, **kwargs)
        
        environment = self.node.try_get_context("environment") or "dev"
        config = self.node.try_get_context(environment) or {}
        
        instance_type = config.get("instanceType", "t3.micro")
        vpc_cidr = config.get("vpcCidr", "10.0.0.0/16")
        db_size = config.get("databaseSize", "db.t3.small")
        enable_monitoring = config.get("enableEnhancedMonitoring", False)
        
        # Now build your stack using these values
        vpc = ec2.Vpc(
            self, "Vpc",
            cidr=vpc_cidr,
        )
```

This nested approach scales beautifully. As you add more environments or more configuration options, the structure remains clean and the intent is obvious. You can see at a glance what the differences are between dev and prod.

Another pattern involves storing context values in separate files. You might have `context-dev.json` and `context-prod.json`:

```json
{
  "environment": "dev",
  "instanceType": "t3.micro",
  "vpcCidr": "10.0.0.0/16",
  "amiId": "ami-0c55b159cbfafe1f0"
}
```

Then you load the appropriate file during synthesis using the `--context` flag in your deployment script. This separates configuration from code very clearly and makes it easy to audit what's deployed to each environment.

### A Concrete Multi-Environment Deployment Example

Let's walk through a realistic multi-environment scenario to tie everything together. Imagine you're building an auto-scaling web application that needs to run in development, staging, and production environments. The main differences are instance sizes, database capacity, and monitoring settings.

Here's the `cdk.json`:

```json
{
  "app": "python app.py",
  "context": {
    "dev": {
      "instanceType": "t3.micro",
      "desiredCapacity": 1,
      "vpcCidr": "10.0.0.0/16",
      "dbInstanceClass": "db.t3.small",
      "enableDetailedMonitoring": false
    },
    "staging": {
      "instanceType": "t3.small",
      "desiredCapacity": 2,
      "vpcCidr": "10.50.0.0/16",
      "dbInstanceClass": "db.t3.medium",
      "enableDetailedMonitoring": true
    },
    "prod": {
      "instanceType": "m5.large",
      "desiredCapacity": 4,
      "vpcCidr": "10.100.0.0/16",
      "dbInstanceClass": "db.r5.large",
      "enableDetailedMonitoring": true
    }
  }
}
```

Your CDK app loads this configuration and creates a stack:

```python
from aws_cdk import (
    aws_ec2 as ec2,
    aws_autoscaling as autoscaling,
    aws_rds as rds,
    core,
)

class WebAppStack(core.Stack):
    def __init__(self, scope: core.Construct, id: str, env_name: str, **kwargs):
        super().__init__(scope, id, **kwargs)
        
        # Load environment-specific configuration
        env_config = self.node.try_get_context(env_name)
        if not env_config:
            raise ValueError(f"Context not found for environment: {env_name}")
        
        instance_type = env_config["instanceType"]
        desired_capacity = env_config["desiredCapacity"]
        vpc_cidr = env_config["vpcCidr"]
        db_class = env_config["dbInstanceClass"]
        enable_monitoring = env_config["enableDetailedMonitoring"]
        
        # Create VPC
        vpc = ec2.Vpc(
            self, "AppVpc",
            cidr=vpc_cidr,
            nat_gateways=1 if env_name == "prod" else 0,
        )
        
        # Create Auto Scaling Group
        asg = autoscaling.AutoScalingGroup(
            self, "WebServers",
            vpc=vpc,
            instance_type=ec2.InstanceType(instance_type),
            machine_image=ec2.AmazonLinuxImage(generation=ec2.AmazonLinuxGeneration.AMAZON_LINUX_2),
            desired_capacity=desired_capacity,
            min_capacity=desired_capacity,
            max_capacity=desired_capacity * 2,
        )
        
        # Create RDS instance with environment-appropriate sizing
        database = rds.DatabaseInstance(
            self, "AppDatabase",
            engine=rds.DatabaseInstanceEngine.mysql(
                version=rds.MysqlEngineVersion.VER_8_0
            ),
            instance_type=ec2.InstanceType(db_class),
            vpc=vpc,
            removal_policy=core.RemovalPolicy.DESTROY if env_name == "dev" else core.RemovalPolicy.SNAPSHOT,
            backup_retention=core.Duration.days(7 if env_name == "dev" else 30),
            multi_az=env_name == "prod",
        )
        
        # Enable enhanced monitoring for staging and prod
        if enable_monitoring:
            # Configure CloudWatch alarms and detailed metrics
            pass

class WebAppApp(core.App):
    def __init__(self):
        super().__init__()
        
        # Deploy to all three environments
        for env_name in ["dev", "staging", "prod"]:
            WebAppStack(
                self, f"webapp-{env_name}",
                env_name=env_name,
                env=core.Environment(
                    account=core.Aws.ACCOUNT_ID,
                    region=core.Aws.REGION,
                ),
            )

if __name__ == "__main__":
    app = WebAppApp()
```

Now, deploying to each environment is as simple as specifying the environment:

```bash
# Deploy to development
cdk deploy --context environment=dev --require-approval never

# Deploy to staging
cdk deploy --context environment=staging --require-approval never

# Deploy to production (with approval required for safety)
cdk deploy --context environment=prod
```

Or, if you prefer to keep everything in `cdk.json`, you can update it and deploy normally. The point is that your code remains unchanged; only the configuration changes between environments.

### Best Practices for Context Values

As you work more with context values, a few best practices emerge. First, always provide sensible defaults. Use `try_get_context()` instead of `get_context()` and supply a fallback value. This makes your code more forgiving and reduces the chance of surprises when someone forgets to pass a context value:

```python
instance_type = self.node.try_get_context("instanceType") or "t3.micro"
```

Second, document your context values clearly. Either in your README or in comments in the CDK code, explain what each context value does and what valid values are. This is especially important when other team members are using your infrastructure code.

Third, consider using a wrapper or helper class to encapsulate context loading logic, especially if you have many values:

```python
class EnvironmentConfig:
    def __init__(self, stack: core.Stack, env_name: str):
        env_config = stack.node.try_get_context(env_name) or {}
        self.instance_type = env_config.get("instanceType", "t3.micro")
        self.vpc_cidr = env_config.get("vpcCidr", "10.0.0.0/16")
        self.db_class = env_config.get("dbInstanceClass", "db.t3.small")
        self.enable_monitoring = env_config.get("enableDetailedMonitoring", False)

class MyStack(core.Stack):
    def __init__(self, scope: core.Construct, id: str, env_name: str, **kwargs):
        super().__init__(scope, id, **kwargs)
        config = EnvironmentConfig(self, env_name)
        # Use config.instance_type, etc.
```

This approach centralizes your context logic and makes it easier to refactor later.

Fourth, be mindful of sensitive data. Context values are baked into CloudFormation templates, which are visible in the AWS CloudFormation console and can be retrieved via API calls. Never put passwords, API keys, or other secrets in context values. For those, use AWS Secrets Manager or Systems Manager Parameter Store, and reference them from your stack using dynamic lookups.

### Context Values and Synthesis

Understanding how synthesis works with context values helps you debug problems. When you run `cdk synth`, the CDK engine parses your app code, evaluates all your constructs, and produces CloudFormation JSON templates. During this process, it reads context values from `cdk.json` and from any `--context` flags you passed. If a piece of your code reads a context value, that value is resolved and substituted into the construct properties during synthesis.

One important detail: context values are resolved at synthesis time, not at deployment time. This means if you synthesize a template with `--context instanceType=m5.xlarge` and then deploy that template to multiple environments, all of them will get m5.xlarge instances. The template is already fixed by the time it reaches CloudFormation. This is why running synthesis with the correct context values is critical—there's no opportunity to fix mistakes during deployment.

If you need to verify that your synthesis produced the correct template for an environment, you can inspect the generated CloudFormation:

```bash
cdk synth --context environment=prod > prod-template.json
```

Then review the template to confirm it has the right settings. This is a helpful sanity check before deploying to critical environments.

### Combining Context Values with Cross-Stack References

Context values pair well with CDK's cross-stack references. You might use context to decide which VPC to deploy into, then reference that VPC across multiple stacks. Or you might use context to determine which availability zones to use, then pass that information to dependent stacks. This combination gives you tremendous flexibility in designing multi-environment architectures.

For example, you could use context to control whether you're deploying into a new VPC or an existing one:

```python
use_existing_vpc = self.node.try_get_context("useExistingVpc") or False

if use_existing_vpc:
    vpc_id = self.node.try_get_context("vpcId")
    vpc = ec2.Vpc.from_lookup(self, "Vpc", vpc_id=vpc_id)
else:
    vpc = ec2.Vpc(
        self, "Vpc",
        cidr=self.node.try_get_context("vpcCidr") or "10.0.0.0/16",
    )
```

This flexibility allows you to handle complex scenarios where development might use a new dedicated VPC, but staging and production share infrastructure or connect to existing corporate networks.

### Conclusion

Context values are one of CDK's most powerful features for building environment-agnostic infrastructure code. By externalizing configuration into `cdk.json` and command-line flags, you keep your code clean, reusable, and maintainable across multiple environments. Unlike hardcoding, which leads to duplication and error-prone manual processes, context values integrate cleanly with your synthesis workflow. And unlike CloudFormation parameters, which are resolved at deployment time, context values are resolved during synthesis, allowing you to bake environment-specific decisions directly into your CloudFormation templates.

The patterns explored here—nested configuration objects, separate context files, and wrapper classes—provide a foundation for scaling your infrastructure code from a single environment to many. As your CDK skills mature, you'll find that well-organized context values combined with thoughtfully designed constructs let you deploy identical code to dev, staging, and production with confidence, each environment getting exactly the configuration it needs. That's the promise of infrastructure as code: reliable, repeatable, and parametrizable infrastructure without the brittleness of manual processes.
