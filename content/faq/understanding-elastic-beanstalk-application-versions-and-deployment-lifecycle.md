---
title: "Understanding Elastic Beanstalk Application Versions and Deployment Lifecycle"
---

## Understanding Elastic Beanstalk Application Versions and Deployment Lifecycle

When you first deploy an application to AWS Elastic Beanstalk, you might think you're simply uploading code and watching it run. In reality, you're interacting with a sophisticated versioning system that underpins the entire platform. Understanding how Elastic Beanstalk manages application versions is fundamental to deploying reliably, managing costs, and troubleshooting problems in production. This article explores the complete lifecycle of an Elastic Beanstalk application version—from the moment you upload code to the day it's finally cleaned up—and shows you how to manage versions effectively using both the AWS Management Console and the command line.

### What Is an Application Version?

An application version in Elastic Beanstalk is a specific, labeled snapshot of your application code. Think of it as a git tag or a release number—it's an immutable point-in-time record of your application at a particular moment. When you upload source code to Elastic Beanstalk, the platform creates an application version and stores it in Amazon S3. This version can then be deployed to one or more environments, and it persists in your AWS account even after you've moved on to newer versions.

The key insight here is that an application version is not the same as a running environment. An environment is where your application actually executes; a version is the code and configuration it executes. A single application version can be deployed across multiple environments simultaneously, or you can have different versions running in different environments at the same time. This separation is powerful—it means you can test a new version in a staging environment while keeping the old version running in production.

### The Application Version Lifecycle

#### Creating an Application Version

An application version is created the moment you upload code to Elastic Beanstalk. This happens through several possible mechanisms. The most straightforward is using the AWS Management Console: you navigate to your Elastic Beanstalk application, click on "Application versions," and upload a ZIP or WAR file. Behind the scenes, Elastic Beanstalk stores this file in an S3 bucket (usually named something like `elasticbeanstalk-[region]-[account-id]`) and creates a corresponding application version record in its metadata store.

You can also create an application version programmatically using the AWS CLI. The `create-application-version` command allows you to upload code directly from your local machine or reference an S3 object you've already uploaded:

```bash
aws elasticbeanstalk create-application-version \
  --application-name my-app \
  --version-label v1.0.0 \
  --source-bundle S3Bucket=my-bucket,S3Key=app.zip \
  --description "Initial production release"
```

When you use this command, you're specifying the version label (the human-readable identifier for this version), pointing to the S3 location of your code, and optionally providing a description. Elastic Beanstalk validates that the S3 object exists and is accessible, then creates the version record.

If you're using the Elastic Beanstalk CLI (`eb`), creating a version happens implicitly when you deploy. The `eb deploy` command packages your local code, uploads it to S3, and creates a new application version automatically using a generated version label. You can optionally specify a custom version label with the `--label` flag.

#### Immutability and Version Integrity

Once an application version is created, it cannot be modified. The code, configuration, and all associated metadata are locked in place. This immutability is a feature, not a limitation. It ensures that if you deploy version `v1.0.0` today and it works perfectly, that same version will behave identically six months from now. There's no risk of accidental modifications or version drift.

This immutability extends to the source bundle. The ZIP or WAR file stored in S3 for a particular version never changes. If you later delete that S3 object directly (bypassing Elastic Beanstalk's controls), the application version record in Elastic Beanstalk still exists, but you won't be able to deploy it to new environments—though existing environments already running that version will continue to function.

The immutability principle also means that if you want to deploy an updated version of your code, you must create a new application version. You can't just modify the existing one. This enforces discipline: every deployment is a versioned event, and you can always trace back to exactly which version is running where.

#### Deploying a Version to Environments

With an application version created, you can deploy it to an environment. An environment is the actual infrastructure—the EC2 instances, load balancer, security groups, and other resources—where your application runs. The same version can be deployed to multiple environments simultaneously. For example, you might have a `development`, `staging`, and `production` environment, each running a different application version according to your testing and release workflow.

When you initiate a deployment using the console or CLI, Elastic Beanstalk launches an update operation on the target environment. The platform downloads the source bundle for the specified version, processes the code (running any hooks or configuration files), and updates the running instances. During this process, the environment's health might temporarily degrade depending on your deployment policy (all-at-once, rolling, rolling with additional batch, or immutable).

Importantly, deploying a version to an environment doesn't consume or modify the version itself. The version remains unchanged, and if you deploy the same version to ten different environments, all ten will have identical code and behavior.

#### Version Retention and Automatic Cleanup

Elastic Beanstalk doesn't keep application versions around forever. If you deployed a new version every day for a year, you'd have 365 versions cluttering your account. Instead, Elastic Beanstalk implements automatic version retention policies to clean up old versions.

By default, Elastic Beanstalk retains the most recent 100 application versions per application. Beyond that, when a new version is created, the oldest versions are automatically deleted—along with their associated S3 source bundles. You can modify this retention policy at the application level.

To change the retention limit, you can use the AWS CLI's `update-application` command:

```bash
aws elasticbeanstalk update-application \
  --application-name my-app \
  --version-lifecycle-config MaxCount=50
```

In this example, Elastic Beanstalk will keep only the 50 most recent versions. If you want to be more conservative with storage costs, you might lower this number. Conversely, if you need to maintain a longer historical record for compliance or debugging, you can increase it.

There's also a time-based retention policy: `MaxAgeInDays`. You can configure Elastic Beanstalk to delete versions older than a certain number of days, regardless of how many newer versions exist. This is useful if you want to enforce a rolling retention window:

```bash
aws elasticbeanstalk update-application \
  --application-name my-app \
  --version-lifecycle-config MaxAgeInDays=30
```

You can combine both policies—for instance, keeping the 50 most recent versions *and* deleting anything older than 90 days. If both conditions are met, Elastic Beanstalk deletes the version.

One crucial detail: the automatic retention policies do not delete versions that are currently deployed to an active environment. Even if a version exceeds your retention limits, if that version is running in an environment, it won't be removed. This prevents the destructive scenario where your production application suddenly has no version to reference.

#### Manual Version Management

Beyond automatic retention, you can manually delete application versions at any time. Using the console, you navigate to the application versions list, select one or more versions, and delete them. Via the CLI, you use the `delete-application-version` command:

```bash
aws elasticbeanstalk delete-application-version \
  --application-name my-app \
  --version-label v1.2.3
```

If you try to delete a version that's currently deployed to an active environment, the operation will fail with an error. You must first update that environment to a different version before you can delete the old one.

Deleting a version also removes its associated S3 source bundle, freeing up storage. This is where cost management comes in—if you're deploying frequently or have large application packages, the S3 storage for old versions can add up. Regularly cleaning up old versions helps keep costs down.

### Multiple Environments with Different Versions

One of the powerful aspects of Elastic Beanstalk's architecture is that each environment can independently run a different application version. This flexibility is essential for many deployment workflows.

Imagine a typical CI/CD pipeline: developers push code to a feature branch, which triggers an automated build that creates an application version `feature-abc-123`. This version is deployed to a development or staging environment for testing. Meanwhile, the production environment continues running version `v2.1.0`. If the feature passes QA, you promote that feature version to production by updating the environment to run the new version. The old version remains in Elastic Beanstalk's version store, available if you need to roll back quickly.

You can view all application versions and which environments are running which versions using the console or CLI. The `describe-application-versions` command is useful here:

```bash
aws elasticbeanstalk describe-application-versions \
  --application-name my-app
```

This returns a list of all versions for your application, including metadata like the creation date, description, and S3 source location. To see which version is deployed to a specific environment, you use `describe-environment-config`:

```bash
aws elasticbeanstalk describe-environments \
  --application-name my-app \
  --environment-names production
```

The output includes the `VersionLabel` field, showing exactly which version is currently running.

### Version Naming Strategies and Best Practices

The version label is just a string—Elastic Beanstalk doesn't enforce any naming convention. However, adopting a consistent naming strategy makes managing versions much easier, especially as your application matures and you deploy frequently.

A common approach is semantic versioning: `v1.0.0`, `v1.0.1`, `v1.1.0`, `v2.0.0`, etc. This communicates the nature of each release at a glance. A patch version change (`v1.0.0` to `v1.0.1`) suggests a bug fix, while a minor version bump (`v1.0.0` to `v1.1.0`) indicates new features without breaking changes, and a major version bump suggests breaking changes.

Another strategy is to include a timestamp or build number: `2024-01-15-prod`, `build-4527`, or `commit-abc123def`. This makes it easy to correlate versions with specific points in your source control history or CI/CD pipeline.

Some teams use environment-specific labels: `dev-123`, `staging-456`, `prod-789`. This explicitly ties a version to the environment it's meant for, reducing the risk of deploying the wrong version to the wrong place.

The key is consistency. Choose a naming scheme and enforce it across your team. Include this guidance in your deployment runbooks and CI/CD pipeline configuration. When someone logs into the AWS console three months later to troubleshoot an issue, a clear version label makes it immediately obvious which code is running.

### Version Conflicts and Troubleshooting

Occasionally, you'll encounter version-related issues. One common scenario is trying to deploy a version that doesn't exist:

```bash
aws elasticbeanstalk update-environment \
  --application-name my-app \
  --environment-name production \
  --version-label v1.5.0
```

If `v1.5.0` doesn't exist in your application's version history, the operation fails. Check available versions with `describe-application-versions` and verify the exact spelling of the version label you want to deploy.

Another issue arises when a version's S3 source bundle is missing. This can happen if someone manually deletes the S3 object without going through Elastic Beanstalk. The version record still exists, but Elastic Beanstalk can't retrieve the code to deploy it. Attempts to deploy will fail. The solution is to delete the orphaned version and create a new one with valid source.

A subtler issue occurs when you're using automatic retention policies and a frequently-deployed application. If you deploy a new version every few minutes but your retention policy keeps only the last 50 versions, you're constantly deleting and recreating versions. This can be inefficient. In such cases, consider a different naming strategy (e.g., reusing the same version label and uploading fresh code) or adjusting your retention policy to accommodate your deployment frequency.

Version conflicts can also arise in team environments where multiple developers or CI/CD pipelines are creating versions simultaneously. While Elastic Beanstalk is eventually consistent and handles concurrent operations well, race conditions are theoretically possible. Mitigate this by ensuring your CI/CD pipeline generates unique, timestamped version labels and includes idempotent checks before creating versions.

### Practical Workflow: From Code to Production

Let's walk through a realistic scenario to tie everything together. Suppose you're working on a Node.js application and you're following a CI/CD workflow.

First, you commit code to your main branch. This triggers a CI pipeline (e.g., AWS CodePipeline or GitHub Actions) that builds and packages your application into a ZIP file. The pipeline then creates an application version in Elastic Beanstalk:

```bash
aws elasticbeanstalk create-application-version \
  --application-name node-app \
  --version-label prod-$(date +%s) \
  --source-bundle S3Bucket=my-artifacts,S3Key=node-app-$(git rev-parse --short HEAD).zip \
  --process false
```

Notice the `--process false` flag. This tells Elastic Beanstalk not to immediately deploy the version, just store it. We'll deploy it separately.

Next, the pipeline deploys this new version to a staging environment for automated testing:

```bash
aws elasticbeanstalk update-environment \
  --application-name node-app \
  --environment-name staging \
  --version-label prod-1705336800
```

Elastic Beanstalk launches a deployment operation, updates the staging environment's instances, and your automated tests run against the new code. If tests pass, you proceed to production. If they fail, you investigate and iterate.

Once you're confident, a manual approval or a subsequent CI stage deploys the same version to production:

```bash
aws elasticbeanstalk update-environment \
  --application-name node-app \
  --environment-name production \
  --version-label prod-1705336800
```

The production environment now runs the same immutable code that passed all tests in staging. If something goes wrong in production, rolling back is as simple as deploying the previous version:

```bash
aws elasticbeanstalk update-environment \
  --application-name node-app \
  --environment-name production \
  --version-label prod-1705336704
```

Over time, your version history accumulates. The automatic retention policy keeps your account clean, deleting old versions you no longer need. But the versions you care about—the ones deployed to active environments—are never touched.

### Advanced: Version Configuration and Platform Hooks

When Elastic Beanstalk deploys an application version, it doesn't just extract and run your code. It also processes configuration files and executes platform-specific hooks. These are part of the version, in the sense that they're bundled with your source code when you create the version.

For example, if your application includes a `.ebextensions` directory (for traditional Elastic Beanstalk) or a `platform` directory (for Elastic Beanstalk with custom platforms), these configurations are part of the version bundle. When you deploy the version, Elastic Beanstalk applies these configurations to the environment.

This is important for understanding immutability: the configuration is frozen as part of the version, just like the code. If you deploy version `v1.0.0` twice to two different environments at different times, both will receive exactly the same configuration.

### Monitoring and Auditing Versions

Elastic Beanstalk integrates with AWS CloudTrail, which logs all API calls, including version creation and deployment. If you need to audit which versions were created, when, and by whom, CloudTrail provides that history. You can search CloudTrail logs to find events related to `CreateApplicationVersion` or `UpdateEnvironment`.

For monitoring the current state of your versions and environments, the Elastic Beanstalk console provides a dashboard. The "Application versions" page shows all versions, their creation dates, and their current deployment status. This is often the quickest way to get an overview of your application's version landscape.

You can also use CloudWatch to monitor deployment events. When a deployment occurs, Elastic Beanstalk emits events to CloudWatch. You can set up alarms or EventBridge rules to react to deployment successes or failures.

### Cost Implications of Versioning

While application versions themselves don't incur direct charges, the S3 storage used to store source bundles does. If you're deploying a large application frequently and retaining many versions, your S3 costs can grow. This is where understanding retention policies becomes cost-relevant.

Calculating the impact: if your application package is 100 MB and you retain 100 versions, that's roughly 10 GB of S3 storage. At standard S3 pricing, this is minimal—less than a dollar per month. But if you're deploying a 500 MB application and retaining 200 versions for compliance reasons, you're now at 100 GB, which costs around $2–3 per month depending on your region. Scale this across dozens of applications, and version management becomes a tangible cost factor.

The takeaway: periodically review your retention policies. Align them with your actual operational needs. You don't need to keep years of history if your business only requires rolling back a few weeks. Tighter retention policies reduce clutter, improve security (fewer old versions means fewer potential vulnerabilities), and lower costs.

### Conclusion

Elastic Beanstalk's application versioning system is a elegant, often-overlooked feature that underpins reliable deployments. By treating each upload as an immutable version, Elastic Beanstalk ensures reproducibility and traceability. The ability to deploy different versions to different environments simultaneously enables sophisticated CI/CD workflows, while automatic retention policies keep your account tidy without sacrificing the history you need.

As you work with Elastic Beanstalk, internalize these key principles: versions are immutable snapshots of code; multiple environments can run different versions; retention policies automatically clean up old versions while protecting deployed ones; and consistent version naming dramatically improves operational clarity. Master these concepts, and you'll be well-equipped to manage Elastic Beanstalk applications at any scale, whether you're deploying a simple web service or orchestrating deployments across a complex microservices architecture.
