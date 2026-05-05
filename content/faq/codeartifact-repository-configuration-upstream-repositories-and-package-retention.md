---
title: "CodeArtifact Repository Configuration: Upstream Repositories and Package Retention"
---

## CodeArtifact Repository Configuration: Upstream Repositories and Package Retention

Managing dependencies at scale is one of those problems that seems simple until it isn't. You start with a few projects, each pulling packages from public registries like npm or Maven Central, and everything works fine. Then your organization grows. You have dozens of teams, hundreds of projects, and suddenly you're worried about supply chain security, build reliability, and whether your CI/CD pipelines will break if the internet hiccups. This is where AWS CodeArtifact becomes invaluable.

CodeArtifact is a fully managed artifact repository service that acts as both a cache for public packages and a private registry for your organization's internal packages. But getting it right requires understanding how to configure upstream repositories, manage package retention, and enforce security policies. In this guide, we'll walk through everything you need to know to set up CodeArtifact repositories that scale with your organization while keeping your dependencies secure and your builds reliable.

### Understanding CodeArtifact's Role in Your Architecture

Before diving into configuration, let's clarify what CodeArtifact actually does and why it matters. Think of it as a thoughtfully designed middleman between your developers and the wild, interconnected world of open-source packages. Instead of each build fetching packages directly from npm, PyPI, Maven Central, or wherever, every request flows through CodeArtifact. This single point of control unlocks several powerful capabilities.

First, CodeArtifact caches public packages locally, which means faster builds and reduced bandwidth costs. If your CI/CD pipeline builds a thousand times a month and each build pulls the same React dependencies, that's a thousand unnecessary downloads from public registries when CodeArtifact could serve them instantly from your own infrastructure in AWS.

Second, CodeArtifact gives you visibility and control over what's flowing into your organization. You can audit which versions of which packages are being used, enforce approval workflows for certain packages, and prevent malicious or vulnerable packages from ever reaching your developers' machines.

Third, CodeArtifact becomes your organization's central hub for publishing internal packages. Instead of awkward file shares or GitHub workflows, teams can publish their shared libraries, internal frameworks, and reusable components to CodeArtifact, making them discoverable and manageable across the organization.

### The Anatomy of CodeArtifact: Domains and Repositories

CodeArtifact's organizational structure reflects how real teams work. At the top level, you have a *domain*, which is a namespace that contains multiple repositories and, critically, serves as the account boundary for cross-team collaboration. Within a domain, you create individual *repositories*, each focused on a specific package format or project.

Think of a domain as your organization's package management headquarters. A single AWS account might have one domain (or a few for different business units), and that domain might contain dozens of repositories. One repository might be for npm packages, another for Python packages, another for internal Maven artifacts. The beauty of this structure is that repositories can reference each other—a npm repository can have a Maven repository as an upstream source, for instance—and developers can configure their tools to pull from multiple repositories transparently.

When you create a repository in CodeArtifact, you're specifying its package format (npm, PyPI, Maven, NuGet, or generic), giving it a name, and optionally defining upstream repositories. The upstream repositories are where the magic happens.

### Configuring Upstream Repositories: Your Cache for Public Packages

An upstream repository is a source that CodeArtifact checks when a package isn't found locally. In practice, most organizations connect their repositories to public package registries. When a developer requests a package that CodeArtifact doesn't already have cached, CodeArtifact fetches it from the upstream source, stores a copy locally, and serves it to the developer.

Let's walk through setting up a practical example. Suppose you're creating a npm repository for your frontend team. You'd want to connect it to the official npm public registry so that your developers can access all the packages they need. You'd also want to connect it to an internal npm repository where your organization publishes shared components.

Here's how you'd create this repository using the AWS CLI:

```bash
aws codeartifact create-repository \
  --domain my-company-domain \
  --repository frontend-packages \
  --format npm \
  --upstream-repositories repositoryName=internal-npm,domainOwner=123456789012
```

This command creates a repository called `frontend-packages` in the format npm, with an upstream dependency on `internal-npm`. But notice something important: we haven't connected the public npm registry yet. That requires a separate step.

To connect to a public registry, you first need to create an external connection. This is CodeArtifact's term for a connection to an external public repository. AWS manages these connections, so you don't need to worry about authentication details with external registries.

```bash
aws codeartifact create-repository \
  --domain my-company-domain \
  --repository frontend-packages \
  --format npm \
  --upstream-repositories \
    repositoryName=internal-npm,domainOwner=123456789012 \
    repositoryName=public-npm,domainOwner=123456789012
```

Wait—that still requires `public-npm` to already exist. Let me clarify the right sequence. You'd first create the public repository (which has an external connection), then create your internal repository pointing to it:

```bash
# Step 1: Create a repository with an external connection to npm
aws codeartifact create-repository \
  --domain my-company-domain \
  --repository public-npm \
  --format npm

# Step 2: Add an external connection to the official npm registry
aws codeartifact associate-external-connection \
  --domain my-company-domain \
  --repository public-npm \
  --external-connection "public:npmjs"
```

Now you have a repository (`public-npm`) that's connected to the official npm registry. When a package isn't found in `public-npm`, CodeArtifact automatically fetches it from npm and caches it.

```bash
# Step 3: Create your team's repository with upstream to both public and internal
aws codeartifact create-repository \
  --domain my-company-domain \
  --repository frontend-packages \
  --format npm \
  --upstream-repositories \
    repositoryName=public-npm,domainOwner=123456789012 \
    repositoryName=internal-npm,domainOwner=123456789012
```

The search order matters. CodeArtifact checks upstream repositories in the order you specify them. In this case, it would check `public-npm` first, then `internal-npm`. This ordering lets you create nuanced dependency resolution strategies.

### Practical Upstream Repository Patterns

Different organizations structure their upstreams differently based on their needs. Let's look at some common patterns.

**The Centralized Cache Pattern** works well for organizations that want a single, tightly controlled entry point. You create one "public" repository with external connections (connected to npm, PyPI, Maven Central, etc.), and all developers point their individual project repositories to this central cache. This gives you maximum visibility and control—every package that enters your organization flows through this one gateway.

**The Specialized Repository Pattern** suits larger organizations with specialized teams. Your frontend team has a frontend-packages repository that connects to npm and your internal frontend components library. Your backend team has a backend-packages repository that connects to Maven Central and your internal Java utilities. Each team owns their repository, but everything still flows through CodeArtifact, so you maintain organizational visibility.

**The Mirror Pattern** is less common but useful for organizations working in restricted network environments. You create repositories with external connections in a "gateway" AWS account, then have other repositories in other accounts reference these as upstreams. This ensures that internet-bound traffic only happens in one controlled location.

When designing your upstream strategy, consider these factors: How many teams do you have? How much overlap is there in their dependencies? How strictly do you need to control what packages enter the organization? How much network bandwidth do you want to save? The answers to these questions will guide your architecture.

### Configuring Your CLI to Use CodeArtifact

Having a repository is worthless if developers don't know how to use it. The next critical step is configuring your local development environment and CI/CD pipelines to fetch packages from CodeArtifact instead of public registries.

For npm, the configuration happens in your `.npmrc` file. CodeArtifact provides a convenient command to generate the correct configuration:

```bash
aws codeartifact get-authorization-token \
  --domain my-company-domain \
  --domain-owner 123456789012 \
  --query authorizationToken \
  --output text | aws codeartifact login \
    --tool npm \
    --domain my-company-domain \
    --domain-owner 123456789012 \
    --repository frontend-packages \
    --region us-east-1
```

This command does something clever: it obtains a temporary authentication token (valid for 12 hours), and then configures npm to use that token when communicating with CodeArtifact. The `login` command modifies your `.npmrc` file with entries like:

```
registry=https://my-company-domain-123456789012.d.codeartifact.us-east-1.amazonaws.com/npm/frontend-packages/
//my-company-domain-123456789012.d.codeartifact.us-east-1.amazonaws.com/npm/frontend-packages/:_authToken=<token>
```

For Python developers using pip, the approach is similar but slightly different:

```bash
aws codeartifact get-authorization-token \
  --domain my-company-domain \
  --domain-owner 123456789012 \
  --query authorizationToken \
  --output text | aws codeartifact login \
    --tool pip \
    --domain my-company-domain \
    --domain-owner 123456789012 \
    --repository python-packages \
    --region us-east-1
```

This modifies your pip configuration to point to the CodeArtifact endpoint. Maven and NuGet have similar but slightly different processes, but the principle is the same: authenticate once, then let your package manager transparently use CodeArtifact.

In CI/CD pipelines, you'd typically embed these login commands early in your build process, often in a build script or as part of your CI configuration. Since the tokens are temporary, this ensures that even if credentials leak in logs, they're only valid for a few hours.

### Managing Package Retention Policies

Here's a scenario that plays out in countless organizations: you've been using CodeArtifact for a year, and you've published hundreds of versions of your internal packages. Your domain storage is growing, your costs are creeping up, and you're hoarding old versions that nobody's using anymore. This is where retention policies save the day.

A retention policy specifies how long CodeArtifact should keep versions of packages before automatically removing them. You can set different retention rules based on package versions, creation time, and other factors.

Let's create a retention policy that keeps the most recent five versions of any package, plus any version created in the last 30 days:

```bash
aws codeartifact put-repository-retention-configuration \
  --domain my-company-domain \
  --repository internal-packages \
  --retention-days 30 \
  --max-versions-retained 5
```

This tells CodeArtifact: keep every version created in the last 30 days, and always keep at least the 5 most recent versions, even if they're older than 30 days. This balances the need to preserve recent history with the desire to clean up ancient versions.

You can also apply more granular retention policies. For instance, you might want to keep releases longer than snapshots:

```bash
aws codeartifact put-repository-retention-configuration \
  --domain my-company-domain \
  --repository java-packages \
  --retention-days 90 \
  --max-versions-retained 20
```

In this example, Maven releases are retained for 90 days with a minimum of 20 versions. Snapshots, which are temporary build artifacts, might have a shorter retention window.

Think carefully about your retention policy. Too aggressive, and you might delete versions that older projects still depend on. Too lenient, and you're paying for storage you don't need. A good starting point is to keep the last 10 versions of every package plus anything created in the last 60 days, then adjust based on your actual usage patterns.

### Publishing and Sharing Internal Packages

Once you've set up the infrastructure, you need to populate it with your organization's internal packages. Publishing to CodeArtifact works similarly to publishing to public registries, but with CodeArtifact as the target.

For a npm package, you'd configure your `.npmrc` during the publish process:

```bash
aws codeartifact get-authorization-token \
  --domain my-company-domain \
  --domain-owner 123456789012 \
  --query authorizationToken \
  --output text | aws codeartifact login \
    --tool npm \
    --domain my-company-domain \
    --domain-owner 123456789012 \
    --repository internal-npm \
    --region us-east-1

npm publish
```

The package gets published to `internal-npm`, where it's immediately available to any other repository in your domain that has `internal-npm` as an upstream. This means your frontend team's repository, your mobile team's repository, and your backend team's repository can all depend on shared packages published to `internal-npm`.

For Python packages, the process is similar:

```bash
aws codeartifact get-authorization-token \
  --domain my-company-domain \
  --domain-owner 123456789012 \
  --query authorizationToken \
  --output text | aws codeartifact login \
    --tool twine \
    --domain my-company-domain \
    --domain-owner 123456789012 \
    --repository internal-python \
    --region us-east-1

twine upload dist/*
```

This creates a self-service package management system within your organization. Teams can publish libraries without going through a centralized approval process (unless you add one), but everything is discoverable and auditable through CodeArtifact.

### Using Domains for Cross-Team Collaboration

As your organization grows and your CodeArtifact usage expands, domains become increasingly important. A domain is more than just a container for repositories—it's the boundary for cross-team and even cross-account collaboration.

Within a domain, all repositories can reference each other as upstreams, and users with appropriate permissions can access packages from any repository. This means your domain becomes a single namespace for all package management. If your organization has multiple teams in multiple AWS accounts, you can configure domain delegation to allow those teams to access the central domain's repositories.

Here's how you'd set up cross-account access to a domain. First, in the account that owns the domain, you create a domain delegation policy:

```bash
aws codeartifact put-domain-permissions-policy \
  --domain my-company-domain \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "AWS": "arn:aws:iam::999888777666:root"
        },
        "Action": [
          "codeartifact:GetAuthorizationToken",
          "codeartifact:ReadFromRepository"
        ],
        "Resource": "*"
      }
    ]
  }'
```

This policy allows users in account `999888777666` to read from any repository in your domain. They can now configure their CLI tools to use repositories in your domain even though their AWS credentials are in a different account.

This pattern scales across entire organizations. You might have a "platform" team that owns the central CodeArtifact domain, and dozens of product teams in other accounts that depend on packages published there. Everyone benefits from the caching, the unified visibility, and the security controls.

### Implementing Repository Policies for Security

With great package management power comes the responsibility to keep bad packages out. Repository policies let you enforce fine-grained access controls and approval workflows.

A basic repository policy might restrict who can publish packages. Here's a policy that only allows users in a specific IAM group to publish to a repository:

```bash
aws codeartifact put-repository-permissions-policy \
  --domain my-company-domain \
  --repository internal-packages \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Principal": {
          "AWS": "arn:aws:iam::123456789012:group/package-publishers"
        },
        "Action": [
          "codeartifact:GetAuthorizationToken",
          "codeartifact:ReadFromRepository",
          "codeartifact:PublishPackageVersion"
        ],
        "Resource": "*"
      },
      {
        "Effect": "Allow",
        "Principal": {
          "AWS": "*"
        },
        "Action": [
          "codeartifact:GetAuthorizationToken",
          "codeartifact:ReadFromRepository"
        ],
        "Resource": "*",
        "Condition": {
          "IpAddress": {
            "aws:SourceIp": "10.0.0.0/8"
          }
        }
      }
    ]
  }'
```

This policy says: members of the `package-publishers` group can read and publish packages. Everyone else (even within the organization) can only read packages if they're on the internal network (10.0.0.0/8). This prevents external users from accidentally publishing to your internal repository while still allowing CI/CD pipelines running in EC2 instances to publish packages.

You can also use repository policies to enforce approval workflows. While CodeArtifact doesn't have built-in approval gates, you can combine it with other AWS services. For example, you might have a CI/CD pipeline that only publishes to `internal-packages` after a pull request has been reviewed and approved. The repository policy ensures that only the CI/CD pipeline's role can publish, preventing developers from accidentally publishing unapproved code.

### External Connections and Public Package Security

Remember earlier when we created an external connection to the public npm registry? External connections are powerful, but they deserve careful attention from a security perspective.

When you connect to a public registry, CodeArtifact caches every package that developers request. This is generally good—it improves build speed and reduces bandwidth. But it also means you're implicitly allowing your developers to depend on every package in the public registry unless you add explicit restrictions.

To add guardrails, you can use repository policies to restrict which packages can be fetched from public registries. While CodeArtifact doesn't have built-in package allowlisting, you can combine it with AWS Lambda and EventBridge to inspect packages as they're pulled from public registries.

Here's a simpler approach that many organizations use: create a "blessed" internal repository that re-exports only the public packages you've explicitly approved:

1. A central team maintains an internal repository with a whitelist of approved public packages.
2. Other teams' repositories point to this internal repository as their upstream source for public packages.
3. Before adding a package to the whitelist, the central team reviews its security, licenses, and maintainer status.

This creates an approval gate without blocking the entire CI/CD pipeline. Developers can still use new packages quickly, but everything flows through a controlled process.

### Monitoring and Cost Optimization

CodeArtifact costs are primarily based on storage (for cached and published packages) and data transfer (for packages downloaded from upstreams). Both are manageable, but they can creep up if you're not watching.

Use CloudWatch metrics to monitor your repositories. CodeArtifact publishes metrics like `RepositoryStorageUsed`, `GetPackageVersionAsset` (number of package downloads), and `PublishPackageVersion` (number of publishes). Setting up CloudWatch alarms for storage growth helps you catch retention policy issues early:

```bash
aws cloudwatch put-metric-alarm \
  --alarm-name codeartifact-storage-high \
  --alarm-description "Alert when CodeArtifact storage exceeds 100GB" \
  --metric-name RepositoryStorageUsed \
  --namespace AWS/CodeArtifact \
  --statistic Average \
  --period 3600 \
  --threshold 107374182400 \
  --comparison-operator GreaterThanThreshold \
  --alarm-actions arn:aws:sns:us-east-1:123456789012:alerts
```

To optimize costs, review your retention policies regularly. If you see that most packages are older than your retention window and nobody's complaining about missing versions, you can tighten the policy. Conversely, if you're seeing many cache misses (packages being fetched from upstreams repeatedly), you might need more aggressive retention.

Also consider where your data transfer is happening. Downloading packages from npm's CDN to AWS is cheap. Downloading from CodeArtifact to developers' machines outside AWS can be more expensive due to data transfer costs. For distributed teams, consider using CodeArtifact in multiple regions and having developers point to the nearest region.

### Building a Complete CodeArtifact Strategy

Let's tie everything together with a concrete example of what a mature CodeArtifact setup might look like in a mid-sized organization.

You have a central platform team that owns the CodeArtifact domain. They create repositories for each major package format and connect them to public registries:

- `npm-public` connected to the npm registry
- `pypi-public` connected to PyPI
- `maven-public` connected to Maven Central

They also create internal repositories where teams publish their shared code:

- `npm-internal` for JavaScript libraries
- `python-internal` for Python utilities
- `java-internal` for Java frameworks

Individual product teams create their own repositories that point to both public and internal upstreams:

- Frontend team: `frontend-app` → `npm-internal` → `npm-public`
- Backend team: `backend-api` → `java-internal` → `maven-public`
- Data team: `data-pipeline` → `python-internal` → `pypi-public`

The domain has a retention policy that keeps the last 20 versions of every package plus anything created in the last 90 days. Public packages (those cached from upstreams) have a shorter retention period (30 days) to save storage costs, since they can always be re-fetched if needed.

Repository policies ensure that only the CI/CD pipeline for a particular team can publish to that team's internal repository. A separate "package-approval" group maintains the public-facing repositories and can publish approved packages to the internal repositories.

Developers configure their local environments with a simple script that logs into CodeArtifact and sets up their package managers to use the appropriate repositories. The script is checked into the repository and documented in the development setup guide, so onboarding new team members is just one command.

The platform team monitors storage usage and reviews popular packages to ensure nothing unexpected is slipping in. They've also created a runbook for handling the occasional security incident where a malicious package gets into the public registry—they can quickly pull it from CodeArtifact's cache and alert teams to update their dependencies.

### Key Takeaways and Next Steps

CodeArtifact transforms package management from something that just works into something you can actually control, observe, and optimize. By setting up upstream repositories thoughtfully, configuring retention policies appropriately, and implementing security controls via repository policies, you create a foundation that scales with your organization.

The key principles to remember: structure your repositories to match your organizational structure, use retention policies to balance cost and availability, configure your CLI tools consistently across all developers and CI/CD systems, and implement security policies at the repository and domain level to prevent unwanted packages from entering your organization.

As you implement CodeArtifact, start simple. Create one repository with upstreams to the public registries your organization uses most. Get a few teams using it, monitor what happens, and expand from there. The sophistication of domains, cross-account access, and nuanced retention policies can all be added later as your needs grow.

The final piece is to build a culture around CodeArtifact. Document your package management strategy. Create self-service tooling to help teams configure their environments. Establish clear ownership of internal repositories. Make it easy to do the right thing—use CodeArtifact, respect retention policies, publish approved packages—and your organization's dependency management will be significantly more mature and secure than when you started.
