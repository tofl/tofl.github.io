---
title: "ECR Cross-Account Access: Configuring Repository Policies"
---

## ECR Cross-Account Access: Configuring Repository Policies

Imagine you're building a microservices architecture where container images live in a centralized, shared services AWS account, but your application teams deploy from separate accounts. Your developers push images to one place, yet teams across the organization need to pull those same images. This is where ECR cross-account access becomes invaluable—and configuring it correctly requires understanding both sides of the access equation.

In this guide, we'll walk through the complete process of enabling container image pulls across AWS accounts using Amazon Elastic Container Registry (ECR). You'll learn how repository policies work, which IAM permissions matter most, and how to troubleshoot the inevitable access denied errors that trip up many developers. By the end, you'll understand not just the mechanics, but the reasoning behind each configuration step.

### Why Cross-Account ECR Access Matters

In most organizations larger than a handful of teams, you'll eventually face a choice: do you want each team managing their own container registry, or do you centralize image management? The centralized approach—often called the shared-services-account pattern—offers real benefits. A single source of truth for images means easier vulnerability scanning, consistent tagging strategies, and simpler compliance audits. But it also means your applications running in other accounts need permission to pull from that central registry.

Without proper cross-account access, you'd end up copying images between accounts, duplicating effort, and losing track of which version is truly authoritative. ECR's repository policy feature lets you avoid that mess entirely.

### Understanding ECR Repository Policies

An ECR repository policy is a resource-based policy—it lives on the repository itself, not on an IAM role. Think of it as a bouncer at the door of your registry: it controls who can perform what actions on that specific repository, regardless of which account they're calling from.

The policy follows standard AWS JSON policy structure with four key components: Effect (Allow or Deny), Principal (who gets access), Action (what they can do), and Resource (what they're accessing). For ECR repositories, the Resource is almost always the repository ARN itself.

Here's the anatomy of a basic cross-account repository policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "arn:aws:ecr:us-east-1:987654321098:repository/my-app"
    }
  ]
}
```

In this example, we're allowing the entire AWS account `123456789012` to pull images from the repository in account `987654321098`. The principal here is specified at the account root level, which means any entity in that account with the right IAM permissions can attempt to access the repository.

### The Three Critical ECR Actions

When configuring cross-account access, you need to understand the three actions that make pulling images work. These aren't interchangeable—each serves a specific purpose in the pull process.

**ecr:BatchGetImage** is the permission that allows a principal to actually retrieve image manifests and layer data. When your container runtime (Docker, containerd, or whatever orchestration tool you're using) pulls an image, it's fundamentally calling BatchGetImage to get the image's content. Without this permission, even if everything else is configured correctly, the pull will fail at the most basic level.

**ecr:GetDownloadUrlForLayer** provides the ability to obtain pre-signed download URLs for individual image layers. ECR breaks images into layers, and each layer is stored separately. The container runtime needs to download each layer, and this permission grants access to the URLs that allow that download. You might wonder why this is separate from BatchGetImage—the answer is security granularity. Some workflows need to retrieve image metadata without necessarily needing to download the actual layer data.

**ecr:GetAuthorizationToken** is slightly different because it operates at the registry level, not the repository level. When you authenticate to ECR (using `aws ecr get-login-password` or similar commands), you're calling GetAuthorizationToken to obtain a temporary credential token. This token is what allows subsequent image pulls to work. Importantly, GetAuthorizationToken must be granted in an IAM policy on the pulling account's side—the repository policy can't grant it. We'll return to this crucial point shortly.

### The Two-Sided Permission Model

Here's where many developers stumble: ECR cross-account access requires permissions on both sides. The repository policy grants permission at the resource level, but the pulling account's IAM role or user must also have matching permissions. They work together—neither alone is sufficient.

Think of it like a bouncer and a guest list. The repository policy is the guest list (the bouncer checks it). But the guest also needs a valid ID from the pulling account's IAM system. If either check fails, entry is denied.

Let's say your pulling account is `111111111111` and your registry account is `222222222222`. For a container running in account `111111111111` to pull an image from a repository in account `222222222222`, you need:

1. A repository policy in account `222222222222` that allows principals from account `111111111111` to call BatchGetImage and GetDownloadUrlForLayer
2. An IAM role in account `111111111111` (attached to the container) that grants permissions for ecr:GetAuthorizationToken (to any ECR in that region, or specifically to the registry endpoint) plus ecr:BatchGetImage and ecr:GetDownloadUrlForLayer for the specific repository in the other account

When you're missing one of these, you'll see an AccessDenied error, but it's important to know which side is rejecting you. Let's move to a concrete example that shows both pieces working together.

### Implementing the Shared-Services-Account Pattern

The shared-services-account pattern is the most common real-world scenario. You have a central account where all container images live, and multiple other accounts where applications are deployed. This example walks through setting it up.

Assume the following:
- Central registry account: `987654321098` (us-east-1 region)
- Application account pulling images: `123456789012` (us-east-1 region)
- Repository name: `payment-service`
- IAM role in the pulling account: `ecsTaskExecutionRole`

**Step 1: Create the repository policy in the central account**

In account `987654321098`, you'd navigate to the ECR repository named `payment-service` and add this policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:root"
      },
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "arn:aws:ecr:us-east-1:987654321098:repository/payment-service"
    }
  ]
}
```

This tells ECR: "anyone from account 123456789012 is allowed to pull from this repository." The `root` principal is a shorthand for the entire account—it means any principal within that account with the appropriate IAM permissions can perform these actions.

**Step 2: Configure the IAM role in the pulling account**

In account `123456789012`, attach a policy to the role that will be used by your containers (in this case, `ecsTaskExecutionRole`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "arn:aws:ecr:us-east-1:987654321098:repository/payment-service"
    }
  ]
}
```

Notice that GetAuthorizationToken uses a wildcard Resource because authentication tokens are registry-wide, not repository-specific. The other two actions are scoped to the specific repository in the other account.

**Step 3: Assign the role to your container**

In ECS or EKS, ensure your task definition or pod specification uses the `ecsTaskExecutionRole`. This is where the IAM policy we just created gets evaluated when the container runtime attempts to pull the image.

With both pieces in place, when your container starts, it can:
1. Call GetAuthorizationToken in account `123456789012` (succeeds because the IAM policy allows it)
2. Retrieve an authentication token that's valid for ECR in that account's region
3. Attempt to pull the image from the repository in account `987654321098`
4. Call BatchGetImage and GetDownloadUrlForLayer (succeeds because the repository policy in account `987654321098` allows account `123456789012`, and the IAM policy in account `123456789012` allows it)
5. Download the image layers and run the container

### Granting Access to Multiple Accounts

If multiple application accounts need to pull from the same repository, you have a few options. The simplest is to list each account root in the Principal section:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::111111111111:root",
          "arn:aws:iam::222222222222:root",
          "arn:aws:iam::333333333333:root"
        ]
      },
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "arn:aws:ecr:us-east-1:987654321098:repository/payment-service"
    }
  ]
}
```

This works well for a handful of accounts. For large-scale deployments with many accounts, you might also consider being more specific about which roles within those accounts can access the repository, rather than granting access to the entire account root. This follows the principle of least privilege.

For example, if only certain ECS task execution roles should have access:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": [
          "arn:aws:iam::111111111111:role/ecsTaskExecutionRole",
          "arn:aws:iam::222222222222:role/ecsTaskExecutionRole",
          "arn:aws:iam::333333333333:role/ecsTaskExecutionRole"
        ]
      },
      "Action": [
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ],
      "Resource": "arn:aws:ecr:us-east-1:987654321098:repository/payment-service"
    }
  ]
}
```

This approach is more restrictive but requires you to maintain the list of role ARNs. It's more secure because a compromise of one account's credentials still can't access the repository unless that specific role is compromised.

### Troubleshooting Common AccessDenied Errors

When cross-account ECR access fails, the error messages can be cryptic. Here's how to systematically work through the problem.

**Error: "User is not authorized to perform: ecr:GetAuthorizationToken"**

This error means the IAM role in the pulling account doesn't have permission to call GetAuthorizationToken. Check the IAM policy attached to the role executing the container—it must explicitly allow `ecr:GetAuthorizationToken` with a wildcard resource. This is purely an account-side permission, unrelated to the repository policy.

**Error: "User is not authorized to perform: ecr:BatchGetImage"**

This error could stem from two sources. First, check that the pulling account's IAM policy grants `ecr:BatchGetImage` for the specific repository ARN in the source account. Second, verify that the repository policy in the source account allows the pulling account. You can have a perfect IAM policy but still get denied if the repository policy doesn't explicitly grant access.

To debug, use the AWS CLI to check both sides. In the source account, run:

```bash
aws ecr describe-repositories --repository-names payment-service --region us-east-1
```

Then view the repository policy:

```bash
aws ecr get-repository-policy --repository-name payment-service --region us-east-1
```

In the pulling account, verify the IAM role's attached policies:

```bash
aws iam get-role-policy --role-name ecsTaskExecutionRole --policy-name inline-policy-name
```

If you've attached a managed policy instead, list it with:

```bash
aws iam list-attached-role-policies --role-name ecsTaskExecutionRole
```

Then get the policy details:

```bash
aws iam get-policy-version --policy-arn arn:aws:iam::aws:policy/... --version-id v1
```

**Error: "ImageNotFound" or "RepositoryNotFound"**

Sometimes the image pull fails with a message about the repository not being found. This usually means authentication succeeded, but the repository name or account is wrong. Double-check that the repository ARN in your IAM policy and the image URI you're using both reference the correct account and region. A common mistake is assuming the image can be pulled from a different region—ECR repositories are regional, and you must authenticate to the specific region where the repository exists.

**Error: "Invalid token" or authentication fails**

If you receive an authentication error, the GetAuthorizationToken call likely succeeded, but the token generated isn't valid for the repository's region. Ensure that when you request the authorization token, you're specifying the correct registry endpoint. For cross-account pulls, the endpoint is usually `<account-id>.dkr.ecr.<region>.amazonaws.com`, and you must authenticate to the registry in the region where your repository lives.

### Best Practices for Cross-Account ECR Access

As you implement this pattern, keep these practices in mind to ensure security and maintainability.

**Use account roots sparingly, roles whenever possible.** Granting access to the entire account root (`arn:aws:iam::account-id:root`) is convenient but violates the principle of least privilege. Instead, specify the exact roles or users that need access. If you have many roles across many accounts, consider using organizational units or tags in AWS Identity Center (formerly SSO) to manage access more dynamically.

**Rotate credentials regularly.** Even though you're using IAM roles rather than access keys, the temporary credentials those roles generate should still be rotated by AWS automatically. Never hardcode ECR credentials into your application code. Always use IAM roles and let the container runtime handle authentication.

**Monitor repository access with CloudTrail.** ECR API calls are logged in CloudTrail, including cross-account access attempts. Set up CloudTrail in your central registry account to audit who is accessing which repositories and when. This is invaluable for security investigations and compliance audits.

**Test cross-account access before production.** Set up a test repository in your shared services account and verify that a test container in another account can pull from it before deploying this pattern to production. This catches configuration errors early and ensures your team understands how the mechanism works.

**Document your repository policies.** Repository policies can grow complex, especially when multiple accounts and roles are involved. Add comments or maintain separate documentation explaining why each statement exists and which account or team it grants access to.

**Scope resources tightly in IAM policies.** In the pulling account, restrict the ecr:BatchGetImage and ecr:GetDownloadUrlForLayer permissions to only the repositories that role needs to access. Don't grant broad permissions like `arn:aws:ecr:*:987654321098:repository/*` unless absolutely necessary.

### Conclusion

Cross-account ECR access might seem like a straightforward feature, but the interaction between repository policies and IAM roles catches many developers off guard. The key insight is recognizing that access control happens in two places: the repository policy in the source account acts as a gatekeeper, and the IAM policy in the pulling account provides the credentials.

By understanding the three critical ECR actions (BatchGetImage, GetDownloadUrlForLayer, and GetAuthorizationToken), implementing the two-sided permission model correctly, and following security best practices, you can build a reliable shared container image platform. The shared-services-account pattern scales well across organizations of any size, and once you've set it up correctly, it becomes an invisible, efficient part of your deployment pipeline.

Start by testing with a single repository and one pulling account. Verify that both the repository policy and the IAM policy are in place and correctly scoped. Use CloudTrail and the AWS CLI to troubleshoot any access denied errors methodically. As you gain confidence, expand the pattern to cover all your repositories and accounts, and your organization will benefit from a centralized, auditable container image management system.
