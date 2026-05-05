---
title: "Integrating CodePipeline with Third-Party Source Control: GitHub, GitLab, and Bitbucket"
---

## Integrating CodePipeline with Third-Party Source Control: GitHub, GitLab, and Bitbucket

Every modern software delivery pipeline starts in the same place: your source code repository. Whether your team uses GitHub, GitLab, Bitbucket, or another version control system, AWS CodePipeline needs a secure, reliable way to fetch your code and trigger deployments whenever you push changes. For years, developers relied on the GitHub v1 source action in CodePipeline, but AWS has moved beyond that legacy approach. Today, the recommended path is CodeStar Connections—a unified, modern mechanism that elegantly solves the authentication puzzle while offering features like webhook-based triggering and fine-grained branch filtering.

This guide walks you through the entire process: setting up a CodeStar Connection, configuring it in your CodePipeline, understanding the underlying OAuth flow, and troubleshooting when things go wrong. By the end, you'll understand not just *how* to connect your repository, but *why* this approach is superior to older methods.

### Understanding CodeStar Connections and Why They Matter

CodeStar Connections represent a paradigm shift in how AWS services authenticate with third-party Git providers. Rather than asking you to create personal access tokens and paste them into AWS secrets, CodeStar Connections use OAuth 2.0—the industry-standard protocol for delegated authorization.

Think of OAuth like inviting a friend to your apartment. Instead of giving them your house keys (equivalent to sharing your credentials), you give them a temporary, limited-access pass that expires or can be revoked at any time. The pass says "this person can access my bookshelf but not my bedroom safe." Your friend never sees your keys; they just have permission to do specific things.

When you create a CodeStar Connection to GitHub, you're essentially setting up that temporary pass. AWS gets permission to read your repositories and list your branches, but it never handles your actual GitHub credentials. Your GitHub account remains secure, and you can revoke AWS's access anytime from your GitHub settings without changing any passwords.

This approach offers several concrete advantages over the deprecated GitHub v1 source action. First, it's more secure—no long-lived tokens stored in AWS Secrets Manager that could be compromised. Second, it supports multiple Git providers with the same mechanism, eliminating the need to learn provider-specific source actions. Third, it enables webhook-based triggering, which means your pipeline starts the moment you push code rather than waiting for CodePipeline to poll your repository. Finally, it provides better filtering options, allowing you to trigger pipelines only on specific branches or exclude certain paths.

### Creating a CodeStar Connection: The OAuth Handshake Explained

Before your CodePipeline can pull code, you need to establish a connection. This process involves navigating to AWS, initiating a connection request, and then completing an OAuth authorization dance with your Git provider.

Let's walk through the practical steps. Open the AWS Management Console and navigate to the CodePipeline service. In the left sidebar, you'll find an option called "Connections" under the Developer Tools section. Click "Create connection."

On the connection creation screen, you'll select your provider from a dropdown menu. AWS currently supports GitHub, GitHub Enterprise Server, GitLab, GitLab Self-Managed, Bitbucket, and Bitbucket Server. For this example, let's choose GitHub. You'll then give your connection a descriptive name—something like "my-github-connection" or "team-repos-connection"—and click "Connect to [Provider]."

At this point, AWS redirects you to GitHub's OAuth authorization page. You're logged into GitHub, so you'll see a permission request from AWS Connector for GitHub. The request asks for access to read your repositories, their metadata, and your account profile. This is exactly what CodePipeline needs to fetch source code and detect new commits. You review the permissions, click "Authorize aws-codesuite," and GitHub generates an authorization code that it sends back to AWS.

Behind the scenes, AWS exchanges this authorization code for a long-lived refresh token. This token is encrypted and stored securely in AWS Secrets Manager, associated with your connection. The key insight: AWS never stores your GitHub password or personal access token. If someone gained access to your AWS account, they couldn't retrieve your GitHub credentials because they don't exist in AWS.

After authorization completes, you're redirected back to the AWS console. Your connection status shows as "Available," and it's ready to use. You can verify this by checking the Connections page—your newly created connection appears in the list with a green checkmark.

What if something goes wrong during the OAuth flow? The most common issue is a stale browser session. If you're logged out of GitHub but AWS tries to authorize, you'll hit a login screen. The solution is straightforward: log into GitHub first, then initiate the connection creation again. Another possibility is that your GitHub organization enforces OAuth app restrictions. In that case, a GitHub organization admin must approve the AWS Connector application before you can complete the flow. This is a security feature, not a bug, and your admin can grant approval through GitHub's application settings.

### Configuring the Source Action in CodePipeline

Once your connection is established, using it in a CodePipeline is refreshingly simple. When you create or edit a pipeline, you'll encounter the source action configuration. Rather than choosing "GitHub" (the deprecated v1 action), you'll select "GitHub (Version 2)" or the equivalent for your provider—GitLab, GitLab Self-Managed, Bitbucket, or Bitbucket Server.

The source action settings include several key fields. First, you specify your connection—a dropdown that shows all available connections you've created. This is where you select the GitHub connection you just established. Next, you specify the repository owner, repository name, and branch. The branch field is particularly flexible: you can hardcode a branch name like "main," use a dynamic reference, or specify a wildcard pattern.

Here's a practical example. Suppose your team uses a Git Flow strategy where development happens on "develop," releases are prepared on "release/*" branches, and production deployments use "main." You might create multiple pipelines with different branch filters, or a single pipeline that triggers on all branches and makes intelligent deployment decisions downstream.

The source action also includes an optional "GitHub output variables" checkbox. When enabled, CodePipeline exposes variables about the commit—commit ID, commit message, repository name, branch name—that downstream actions can reference. This is invaluable if you want to, say, embed the commit hash in a Docker image tag or notify Slack with details about the triggering commit.

Under the hood, the source action configuration is stored in your pipeline's CloudFormation template or JSON definition. When you examine the pipeline structure, you'll see the connection specified by its Amazon Resource Name (ARN), not by name. This is important for infrastructure-as-code scenarios: if you're version-controlling your pipeline definition, you need the ARN to reference the correct connection across AWS accounts or regions.

### Understanding Webhook-Based Triggering and Polling

One of the most significant advantages of CodeStar Connections is webhook-based triggering. Unlike the old GitHub v1 action, which relied on polling (CodePipeline repeatedly asking GitHub, "Any new commits yet?"), CodeStar Connections use webhooks. GitHub pushes a notification to AWS the moment you push code, triggering your pipeline nearly instantaneously.

This difference has real implications. Polling-based pipelines might have a delay of several minutes between your push and the pipeline start, depending on CodePipeline's polling interval. Webhook-based pipelines typically start within seconds. For teams doing frequent deployments, this difference compounds into significant time savings. More importantly, webhooks reduce load on both GitHub's API and AWS's services, since polling isn't continuously hammering the API.

When you create a CodeStar Connection and use it in a pipeline, CodePipeline automatically creates a webhook in your Git repository on your behalf. If you navigate to your GitHub repository settings and look at "Webhooks," you'll see an entry pointing to an AWS endpoint. This webhook is configured to fire on push events, and potentially on pull request events if you've set that up in your pipeline triggers.

The webhook payload contains repository metadata and commit information. AWS validates the webhook signature using a shared secret, ensuring that the notification genuinely came from GitHub (or your other Git provider) and hasn't been tampered with in transit. This cryptographic validation is transparent to you but is a critical security measure.

One important caveat: webhooks work best when your CodePipeline's source action is actively polling disabled. In the source action configuration, there's a "Poll for source changes" setting. When using CodeStar Connections with webhook support, you should set this to "No" (the default). Enabling both webhooks and polling is redundant and wasteful.

What happens if the webhook is temporarily unavailable or if CodePipeline's webhook endpoint is down? GitHub retries webhook deliveries with exponential backoff for up to 25 hours. If a delivery fails repeatedly, GitHub eventually stops retrying and you'll need to investigate logs or manually trigger the pipeline. The good news is that connection issues are rare in practice, and AWS's infrastructure is highly available.

### IAM Permissions Required for CodeStar Connections

For CodePipeline to create and use CodeStar Connections, your IAM user or role must have appropriate permissions. Let's examine what's needed.

If you're creating a connection through the AWS Management Console, the console typically handles permissions gracefully—AWS applies your account's default permissions. However, if you're using infrastructure-as-code or the AWS CLI, you need to be explicit about permissions.

At minimum, you need the `codestar-connections:CreateConnection` permission to create a new connection. This permission allows the API call that initiates the OAuth flow. You also need `codestar-connections:AuthorizeConnection` if you're authorizing a connection that was created separately (though in practice, this is combined with creation).

For CodePipeline to reference and use a connection, it needs `codestar-connections:PassConnection`. This permission is often overlooked in IAM policies. Without it, CodePipeline can be created successfully, but it will fail at runtime when trying to use the connection. The `PassConnection` permission is essentially a guard that prevents pipelines in one account or even other services from using your connections without explicit permission.

Additionally, CodePipeline needs permissions to perform its standard source action tasks: accessing CodeArtifact to store artifacts, writing to CloudWatch Logs, and so on. But the connection-specific permissions are the ones that trip up developers most often.

Here's a minimal IAM policy snippet for a developer who creates and uses CodeStar Connections:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "codestar-connections:CreateConnection",
        "codestar-connections:AuthorizeConnection",
        "codestar-connections:PassConnection"
      ],
      "Resource": "arn:aws:codestar-connections:*:ACCOUNT_ID:connection/*"
    }
  ]
}
```

If you want to be more restrictive, you can specify the exact connection ARN instead of a wildcard. If you're using multiple AWS accounts, you might need to grant cross-account access to connections, which involves additional permissions on the connection resource itself.

A common scenario: your development team creates connections in a shared "DevOps" AWS account, and CI/CD pipelines in application accounts need to reference those connections. In this case, you'd need a resource-based policy on the connection (in the DevOps account) that allows the application account's pipeline role to use it. The policy would grant `codestar-connections:PassConnection` to the principal in the application account.

### Troubleshooting Connection Failures

Even with a straightforward process, things sometimes go wrong. Let's walk through the most common issues and how to resolve them.

**The connection shows "Pending" indefinitely.** This usually means the OAuth flow wasn't completed. Navigate back to the Connections page, click on the pending connection, and you'll see a "Connect to [Provider]" button. Click it to restart the authorization flow. Make sure you're logged into your Git provider account first. If you're part of a GitHub organization with OAuth restrictions, have the organization admin approve the AWS Connector application.

**Authorization succeeds, but the pipeline fails to fetch code.** The error message in the pipeline execution typically says something like "AccessDenied" or "Repository not found." First, verify the connection is "Available" on the Connections page. Then, double-check the repository owner and name in the source action configuration—typos are surprisingly common. Finally, ensure the GitHub user account you authorized with has access to the repository. If the repo is private, the authorized account must have at least read access.

**The pipeline starts but then times out fetching source code.** This could indicate a network issue between AWS and GitHub, but it's rare. More likely, the repository is extremely large (hundreds of MB of Git history) and exceeding the source action timeout. If this occurs, consider using a shallow clone, which CodePipeline supports through advanced source action settings.

**The webhook isn't triggering pipeline executions.** First, verify the webhook exists in your repository settings on GitHub (or your Git provider). If it's missing, delete and recreate the connection—AWS will register the webhook anew. If the webhook exists but isn't firing, check the webhook delivery logs in GitHub's repository settings. GitHub shows recent webhook deliveries and their response codes. If AWS is returning error codes, the issue might be temporary infrastructure problems or misconfigured IAM permissions on the pipeline role.

**Error: "Could not determine connection credentials."** This occurs when CodePipeline can't retrieve the stored authorization token from the connection. Causes include: the connection's status is no longer "Available" (perhaps the OAuth token was revoked on the Git provider side), the Git provider's API is down, or there's an AWS service issue. Start by checking the connection status. If it's not "Available," you may need to re-authorize by clicking the connection and selecting "Authorize."

**Connection works locally but fails in CodePipeline.** If you can clone the repo locally using your credentials but CodePipeline can't fetch it, the issue is likely that the authorized Git account doesn't match your personal account. Remember: the connection is authorized under the Git account of whoever clicked "Authorize" during the OAuth flow. If that account lacks access to the repository, CodePipeline will fail. The solution is to have someone with repository access re-authorize the connection.

### Best Practices and Advanced Configurations

Now that you understand the mechanics, let's discuss some practices that make integration with CodePipeline more robust and maintainable.

**Name connections descriptively.** Rather than "connection-1" or "github-conn," use names like "production-repos-connection" or "team-backend-github." This makes it clear in pipeline configurations which connection is being used and prevents accidental misuse.

**Organize connections by repository scope.** If your organization has multiple Git repositories with different access levels, consider creating separate connections for different scopes. For example, one connection authorized by a bot account that accesses all repositories, and another authorized by a user account that accesses only public or team-specific repositories. This limits blast radius if credentials are compromised.

**Use branch filters strategically.** Rather than a single pipeline that triggers on all branches, create separate pipelines for different Git Flow branches if your organization uses that strategy. A "develop-to-staging" pipeline might trigger on the "develop" branch, while a "release-to-production" pipeline triggers only on "main." This reduces unnecessary pipeline executions and makes your CI/CD flow transparent.

**Monitor webhook health.** Set up CloudWatch alarms on CodePipeline metrics to detect when pipelines aren't executing as expected. If you push code and the pipeline doesn't start within a few seconds, something's wrong with the webhook. Logs and metrics can reveal issues quickly.

**Implement least-privilege Git accounts.** When authorizing a CodeStar Connection, use a dedicated bot account if possible, not a developer's personal account. A bot account can be restricted to read-only access to repositories, limiting damage if the account is compromised. Many Git providers offer fine-grained personal access tokens or organization-level bot accounts for exactly this purpose.

**Test connections in non-production pipelines first.** Before relying on a new connection in a production pipeline, create a test pipeline that uses it. This lets you verify the connection works with your specific repository and organization settings before deploying to critical systems.

**Version your pipeline definitions.** If you're using CloudFormation or Terraform to define your pipelines, version control the infrastructure code just like your application code. When you need to update a pipeline, change the code, commit, and deploy. This makes it easy to review changes and roll back if needed. The connection ARN should be parameterized, so you can reference the same connection across multiple environments.

### Comparing with Legacy Approaches

To fully appreciate CodeStar Connections, it's worth understanding what came before.

The GitHub v1 source action, now deprecated, required you to create a personal access token in GitHub, then paste it into an AWS Secrets Manager secret. CodePipeline would retrieve the token from Secrets Manager and use it to authenticate with GitHub. This approach worked, but had significant drawbacks. The token was a long-lived credential stored in AWS, which increased the attack surface. If someone gained access to your AWS account or the Secrets Manager secret was leaked, they had full access to your GitHub account (unless the token was scoped, which GitHub v1 didn't support well).

GitHub v1 also didn't support webhooks in CodePipeline—it always polled. This meant higher latency between pushing code and starting deployments, and unnecessary API calls to GitHub.

Some organizations used a different approach: storing GitHub credentials in AWS Systems Manager Parameter Store or Secrets Manager and manually configuring webhooks outside of CodePipeline. This worked but required more operational overhead and introduced manual steps into the automation.

CodeStar Connections solve all these problems. They use OAuth instead of long-lived tokens, support webhooks natively, and abstract away provider-specific details. The authorization flow is standardized across GitHub, GitLab, Bitbucket, and others, so learning one approach means you can use it across different Git providers.

### Conclusion

Integrating CodePipeline with GitHub, GitLab, Bitbucket, and other Git providers has never been more straightforward than with CodeStar Connections. By leveraging OAuth 2.0 for secure authentication, providing webhook-based triggering for low-latency deployments, and supporting multiple providers with a unified interface, CodeStar Connections represent a significant step forward from legacy approaches.

The process—creating a connection, authorizing it, and referencing it in your pipeline—is intuitive once you understand the underlying OAuth flow and permission model. The key takeaways are: connections use industry-standard OAuth rather than long-lived tokens, webhooks trigger pipelines in near-real-time rather than relying on polling, and proper IAM permissions are essential for reliable operation.

As you build your CI/CD pipelines, start with CodeStar Connections as your default approach. They're secure, scalable, and designed for modern cloud development. When troubleshooting issues, remember that most problems fall into a few categories: incomplete OAuth authorization, missing repository access for the authorized account, or misconfigured IAM permissions. With those foundations in place, your pipelines will reliably pull source code and trigger deployments every time you push changes.
