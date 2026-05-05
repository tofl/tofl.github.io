---
title: "Amplify Pull Request Previews: Isolated Test Environments per PR"
---

## Amplify Pull Request Previews: Isolated Test Environments per PR

Imagine this scenario: you're working on a new feature branch, and you want your product manager to review it without waiting for a full production deploy or manually running the application locally. You'd love a shareable URL that instantly shows exactly what your code does in a real, cloud-hosted environment. Better yet, you want this for every pull request your team opens, automatically. That's the power of AWS Amplify Hosting's pull request preview feature, and it's one of the most underutilized tools for accelerating development workflows.

Pull request previews transform how teams collaborate on frontend and full-stack applications. Rather than context-switching between branches, wrestling with local development environments, or deploying to a staging server, reviewers get instant access to a live, temporary environment that mirrors your PR's exact code. This article walks you through enabling previews, understanding the deployment model, integrating with GitHub status checks, and architecting a secure, cost-effective preview strategy that scales with your team.

### Why Pull Request Previews Matter

Before diving into the mechanics, let's establish why this feature deserves real estate in your deployment toolkit. Traditional development workflows often force a choice between speed and safety. You can merge quickly to a staging environment and risk exposing incomplete work, or you can keep feature branches isolated and rely on local testing and screenshots—both friction-filled approaches.

Pull request previews close this gap elegantly. Each open PR gets its own ephemeral environment with a unique URL, allowing stakeholders to interact with running code rather than reviewing static diffs or running things locally. Designers can validate responsive behavior on real devices. Product managers can test edge cases without waiting for staging availability. Security teams can scan the deployed artifact rather than analyzing code in isolation. Backend developers can verify API integrations against real infrastructure rather than mocked responses.

The preview is not a simulation or a static build artifact; it's a genuine AWS Amplify Hosting deployment, complete with compute, storage, and networking. Your application runs against actual AWS services—or mocked ones if you've configured your environment that way—giving you confidence that the code will behave identically in production (assuming production configuration matches).

### Enabling Pull Request Previews in Amplify Hosting

Getting started is refreshingly straightforward. The feature lives in Amplify Hosting's connection to your Git repository, whether you're using GitHub, GitLab, Bitbucket, or AWS CodeCommit.

First, navigate to your Amplify app in the AWS Console and select the **Hosting** environment you've already connected to your repository. In the left sidebar, find the **App settings** section and open **Build settings**. Within the build configuration, you'll see a toggle or checkbox labeled **PR preview deployments**—enable it. That's genuinely the minimum required configuration.

Once enabled, Amplify monitors your repository for pull requests. When a new PR opens, Amplify automatically triggers a build using your branch's source code. If the build succeeds, Amplify deploys the result to a temporary hosting environment and generates a unique preview URL. This URL follows a predictable pattern: `https://pr-[pr-number].[branch-name].[domain].amplifyapp.com` or similar, depending on your domain configuration.

The beauty of this automation is that it requires zero manual intervention after that initial toggle. Amplify integrates with your repository's webhook system, so every push to a PR branch automatically triggers a new preview build. If your team opens twenty pull requests in a day, twenty preview environments spin up automatically. When a PR closes, the preview is automatically torn down after a retention period you can configure.

### Understanding Amplify's PR Preview Deployment Model

A critical mental shift when working with Amplify previews is recognizing that each preview is a full, real deployment—not a static export, not a Docker image pulled from a registry, not a lightweight container. Amplify builds your source code using your specified build commands, optimizes assets, and deploys the resulting artifacts to its CDN and origin servers. This means your preview consumes actual compute and storage resources, just like your production environment does.

This matters for understanding costs, performance, and risk. Because previews are real deployments, they're genuinely representative of how your code will behave in production. A slow preview reflects a slow production build; a broken preview typically means the code is broken, not the preview system. You're testing with full fidelity, which is the whole point—but it also means each preview carries the same operational responsibilities as any deployment.

From a cost perspective, Amplify's pricing model charges you for bandwidth, build minutes, and storage consumed by previews just as it would for any branch. If you have fifty open PRs at any given time and each consumes 100 MB of storage and generates build artifacts, you're paying for fifty times the baseline storage. Build minutes accumulate; each preview rebuild (triggered by a new commit to the PR branch) consumes additional compute. This isn't necessarily a dealbreaker—previews often cost less than maintaining a dedicated staging environment—but it's important to budget for and monitor.

Many teams implement smart retention policies to manage costs. Rather than keeping previews alive indefinitely, you might set retention to thirty days, meaning old PRs' previews automatically clean up. You can also disable previews for certain branches, such as release branches or long-lived feature branches that are better served by explicit environment management.

### Generating and Sharing Preview URLs

Once your PR preview deploys successfully, the URL appears in multiple places, making it trivial for reviewers to access it. The most obvious location is the Amplify Console itself—navigate to your app, select **Deployments**, and filter by PR previews. Each deployment shows its status, the associated PR number, build time, and the clickable preview URL.

More usefully, Amplify automatically posts a comment on your GitHub PR (or equivalent mechanism in other Git platforms) with a direct link to the preview and build status details. This means reviewers don't need to navigate to the AWS Console; they can simply click a link in the PR thread and immediately see the deployed feature.

Generating URLs is also accessible programmatically. If you've built custom dashboards or automation around your deployment process, you can query the Amplify API to fetch preview URLs, artifact metadata, and build logs. This is particularly useful for larger teams that route deployments through custom CI/CD pipelines alongside Amplify's native workflow.

A practical tip: customize your Amplify app's domain to something memorable and short. A domain like `myapp.amplifyapp.com` is cleaner than the auto-generated alternative, making preview URLs more readable when shared in Slack or email. The custom domain applies to all environments—production, staging, and previews—so you're establishing a consistent brand presence across your environments.

### Integrating with GitHub Status Checks

GitHub's status check API is a powerful mechanism for preventing accidental merges of incomplete or broken code. Amplify integrates natively with this system, automatically posting status checks as previews build and deploy.

When you enable PR previews, Amplify registers itself as a status check provider. Each time a commit lands on a PR branch, Amplify's status appears as pending while the build runs. Once the build completes, the status flips to success (if the build succeeded) or failure (if it didn't). This status appears both in the PR's status section and in the merge dialog, allowing you to establish a branch protection rule requiring Amplify's check to pass before merging.

To set this up, navigate to your GitHub repository settings, select **Branches**, and create a branch protection rule for your main branch. Within that rule, require status checks to pass, and select the Amplify check. Now, no PR can merge until Amplify has successfully built and deployed its preview. This prevents the common scenario where a developer merges code that builds fine locally but fails in the actual build environment due to missing dependencies, environment-specific configuration, or subtle caching issues.

The status check integration also gives you a high-level view of your team's deployment health. A glance at the PR list shows you which feature branches are buildable and which have issues. This visibility often catches problems hours or days earlier than waiting for post-merge incident discovery.

### Security Considerations for PR Previews

Exposing in-development features to the internet via a preview URL introduces security vectors that production deployments might not face. A preview environment is temporary and non-critical, but it still runs your application code and connects to AWS services, potentially including databases, APIs, and authentication systems.

The first consideration is authentication. Should your preview environment use the same authentication system as production, or a separate one? If a preview connects to your production database and authentication system, any security vulnerability in the preview code—say, a SQL injection or unvalidated API endpoint—could expose production data. Many teams isolate previews entirely, using separate AWS accounts, separate databases, or mocked backends for preview environments.

Amplify makes this easy by supporting environment-specific configuration. You can define a preview environment in your `amplify/backend/environments` directory (or equivalent, depending on your Amplify CLI version) that uses different backend resources than production. A preview environment might connect to a sandbox database, use development API keys, or mock external services entirely. This way, a preview can still validate frontend behavior and API contracts without risking production data.

The second consideration is URL exposure. Preview URLs are difficult to guess but not impossible to brute-force if someone knows the URL pattern. If your preview contains sensitive features—unreleased pricing changes, confidential designs, employee data—treat the preview URL as sensitive information. Share it only with intended reviewers, don't post it in public Slack channels, and certainly don't reference it in social media or external communications.

A more sophisticated approach is to require authentication for preview environments. Amplify Hosting supports HTTP basic authentication out of the box; you can set a username and password that viewers must enter before accessing the preview. This isn't bulletproof security—basic auth is trivially broken if the password is shared or captured—but it prevents accidental discovery and adds a small barrier against casual snooping.

For truly sensitive features, some teams go further and require VPN access to reach preview URLs, or they restrict preview URLs to a specific IP range using Amplify's WAF (Web Application Firewall) integration. These approaches are more complex but appropriate for regulated industries or highly confidential features.

### Combining PR Previews with Backend Environment Branching

Frontend-only applications benefit from PR previews immediately, but full-stack applications need one more piece: backend environment branching. A frontend preview without a corresponding backend environment runs against your production backend, which works fine for testing UI changes but breaks when you're also modifying API endpoints, database schemas, or infrastructure.

Amplify's backend environment feature solves this. When you initialize an Amplify backend, you create an environment—typically `dev`, `staging`, `prod`, and so on. Each environment has its own set of resources: databases, authentication systems, APIs, functions, and more. By branching your backend environment alongside your frontend code, you achieve true end-to-end isolation for each feature.

Here's how to implement it: when you create a feature branch for your frontend code, also create a corresponding backend environment for that feature. This might look like `feature/user-dashboard` for the frontend branch and a backend environment named `feature-user-dashboard`. Your Amplify configuration specifies which backend environment the frontend uses; a preview building from the `feature/user-dashboard` branch automatically targets the corresponding backend environment.

Setting this up requires a few steps. First, use the Amplify CLI to create a new backend environment from an existing one: `amplify env add`. This clones your dev environment's configuration, creating a new environment with fresh resources. Commit this environment configuration to your feature branch. Then, update your `amplify/.config/project-config.json` or similar configuration file to specify which environment the branch should use—some teams handle this via Git branch detection, where the CLI automatically selects the matching backend environment based on the branch name.

When your PR preview deploys, it uses the feature-branched frontend code and the feature-branched backend environment, achieving complete isolation. You can test schema changes, new API endpoints, and modified business logic without touching production or staging infrastructure. Once the PR merges, the feature branch's backend environment can either be merged into your main backend environment (by promoting changes manually) or deleted if the feature was rejected.

This approach scales well across teams. A team with five concurrent features runs five PR previews against five temporary backend environments, each isolated from the others and from production. When a feature completes, its environment cleans up automatically (you can configure a retention policy for backend environments too), freeing up costs and reducing clutter.

### Monitoring and Debugging Preview Deployments

Just because a preview is temporary doesn't mean it's opaque. Amplify provides comprehensive logging and monitoring for preview deployments, helping you understand why a build failed, why a feature isn't working, or how performance compares to production.

Each preview deployment includes a build log, accessible from the Amplify Console. The log shows every step of your build process: dependency installation, build command execution, asset optimization, and deployment. If a build fails, the log pinpoints exactly where the failure occurred. A common issue is missing environment variables; if your build script references an environment variable that doesn't exist in the preview environment, the build fails with a clear error message. You can define preview-specific environment variables in the Amplify Console's build settings, allowing you to inject different API endpoints, feature flags, or configuration values into previews compared to production.

Runtime issues—bugs that appear only after deployment—require different debugging tools. Amplify integrates with CloudWatch, AWS's centralized logging service. Your application's logs (if you've configured logging in your code) flow to CloudWatch, where you can search, filter, and analyze them. Your preview's performance metrics—page load time, API latency, error rates—also flow to CloudWatch. This is where you discover that your feature works locally but loads slowly when running against real AWS infrastructure, or that an API call that succeeds in development times out under preview traffic.

For team workflows, consider setting up CloudWatch alarms for preview deployments. An alarm might trigger if a preview's error rate exceeds a threshold, alerting you to investigate before reviewers encounter the broken feature. Alarms can integrate with Slack, email, or SNS notifications, keeping your team in the loop without requiring them to manually check the console.

### Cost Management and Optimization Strategies

Cost is the one concern that often derails preview strategies at scale. A team with a handful of PRs incurs minimal overhead, but a team with thirty concurrent PRs, each rebuilding daily as commits accumulate, can see significant charges if previews aren't managed thoughtfully.

Start by understanding Amplify's pricing model. You pay for bandwidth (data transferred from the CDN and origin servers), build minutes (compute used during the build process), and storage (artifacts stored in Amplify's system and any artifacts you store in S3 or other services). A single preview deployment might consume 50–200 MB of storage and 5–15 build minutes depending on your application's size and complexity. Multiply that by your typical number of open PRs, and you can estimate monthly costs.

Several optimization strategies help control costs without sacrificing preview capability. First, set an aggressive retention policy. Rather than keeping previews indefinitely, configure them to auto-delete after fourteen or thirty days of inactivity. A PR that's been open for three months without updates probably doesn't need its preview environment alive. You can manually extend retention for important PRs that are in active review.

Second, use build caching aggressively. Amplify caches build artifacts by default, but you can optimize by caching dependency directories, build outputs, and other expensive-to-recreate artifacts. A well-configured cache dramatically reduces build time, cutting costs.

Third, consider disabling previews for specific branches or pull request types. Not every branch needs a preview; you might disable previews for release branches, hotfix branches, or branches you know will only modify configuration or documentation. The Amplify Console's build settings allow you to configure branch-specific rules, so previews only deploy when useful.

Fourth, be thoughtful about branch and backend environment cleanup. Each backend environment you create in Amplify consumes resources (even if dormant, some resources have baseline costs). Establish a policy where old feature branches and their corresponding backend environments are automatically deleted after a set period. This prevents accumulation of zombie environments consuming costs without value.

Finally, consider whether your preview strategy needs every PR. Some teams run previews only for PRs labeled with a specific tag, like `needs-preview` or `ready-for-review`. This gives developers control over when previews deploy, allowing them to prevent unnecessary builds on work-in-progress commits. Other teams embrace a "preview everything" philosophy, accepting the cost as part of their development investment.

### Best Practices and Workflow Integration

To maximize the value of PR previews, integrate them thoughtfully into your team's development workflow. The feature itself is straightforward, but the human side—how reviewers use previews, how developers respond to feedback, how previews inform merge decisions—determines whether previews become a core part of your process or a novelty that gets ignored.

Start by establishing a preview culture. When a PR opens, immediately share the preview URL in your communication channels—Slack, Discord, email, whatever your team uses. Make it obvious that previews are available and encourage reviewers to check them before reviewing code. Non-technical stakeholders—designers, product managers, customer success—should review previews first, since that's how they get the most value. Technical code review can happen in parallel or afterward, depending on your process.

Document what each preview environment is safe for. If previews use production databases, be explicit about this so reviewers know not to test potentially destructive operations. If previews use sandbox backends, advertise this as a safe testing ground where all actions are reversible. Setting expectations prevents the dreaded "I accidentally deleted a customer record in the preview thinking it was sandboxed" incident.

Consider using preview URLs in your pull request templates. Your PR template—the boilerplate that appears when someone opens a new PR—can include a section reminding developers to paste the preview URL or noting that one will appear once the build completes. This keeps previews top-of-mind and reduces the friction of finding them.

For asynchronous teams or teams spanning time zones, preview deployments are particularly valuable. Rather than scheduling a synchronous walkthrough call, a developer can deploy a preview, record a brief video walking through the feature, and leave the preview URL for reviewers to explore on their own schedule. This is more efficient than live demos and easier to reference later.

### Troubleshooting Common Preview Issues

Even with solid setup, previews sometimes behave unexpectedly. Understanding common failure modes helps you debug faster.

The most frequent issue is build failures due to missing environment variables. A build script might reference `process.env.REACT_APP_API_ENDPOINT`, but if that variable isn't defined in the preview environment, the build fails. The solution is to define all necessary environment variables in the Amplify Console's build settings, either as literal values or by pulling them from AWS Secrets Manager or Parameter Store. Note that environment variables are often different between environments; a preview targeting a sandbox backend needs different API endpoints than production, so use environment-specific configuration strategically.

Another common issue is authentication failures. If your preview attempts to authenticate against a production authentication system and the credentials or configuration are incorrect, users can't log in. Double-check that your preview environment uses the correct authentication configuration for its backend environment. If using Amplify Auth, verify that the preview's authentication resource is properly linked and that client IDs, secrets, and redirect URIs match the deployment.

Performance problems in previews that don't exist locally often indicate resource contention or networking latency. A preview running behind Amplify's global CDN might experience different latency profiles than your localhost development environment. If a preview feels sluggish, check CloudWatch metrics to identify bottlenecks—is the origin server slow? Is the CDN cache hitting? Is your API backend undersized?

Finally, previews sometimes fail to generate URLs, appearing to deploy successfully but not receiving a public-facing endpoint. This typically indicates an issue with Amplify's deployment orchestration and usually resolves with a retry. If persistent, check the build logs for clues and consult AWS Support.

### Conclusion

Pull request previews are a relatively simple feature with profound implications for development velocity and quality. By enabling automatic, isolated environments for each PR, you collapse the feedback loop between code and review, giving stakeholders immediate access to running code rather than asking them to imagine behavior from diffs and descriptions.

The key to effective preview deployments is recognizing that previews are real deployments—full applications running on real infrastructure—not simulations. This realization informs security decisions (isolate sensitive data), cost management (monitor and limit preview consumption), and workflow integration (treat previews as the primary review artifact, not an afterthought).

As you implement preview deployments, start simple: enable previews, share URLs with your team, and iterate based on what works for your specific workflow. The feature is powerful enough to be useful immediately, but sophisticated enough to grow with your team's needs. Whether you're a solo developer seeking faster feedback or leading a distributed team seeking asynchronous collaboration, Amplify's preview capability is a tool worth investing in.
