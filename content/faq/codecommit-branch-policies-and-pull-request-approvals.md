---
title: "CodeCommit Branch Policies and Pull Request Approvals"
---

## CodeCommit Branch Policies and Pull Request Approvals

When multiple developers collaborate on the same codebase, chaos is just one careless merge away. Without structured code review workflows, you risk introducing bugs, security vulnerabilities, and inconsistent code quality into your main branches. AWS CodeCommit addresses this challenge through a powerful but sometimes underutilized feature: approval rules and branch policies that enforce code review governance at the repository level.

In this guide, we'll explore how to set up and manage CodeCommit approval rules, configure them consistently across your repositories, and integrate them with notifications so your team actually knows when reviews are needed. Whether you're establishing code review practices from scratch or refining existing governance, understanding these tools is essential for building reliable CI/CD pipelines.

### Understanding CodeCommit Approval Rules

An approval rule in CodeCommit is a policy that gates code changes from being merged into protected branches. Unlike simple branch protection (which we'll touch on), approval rules are specific to pull requests and define exactly who must review and approve changes before they're merged.

Think of approval rules as a bouncer at a nightclub with a specific checklist. The bouncer doesn't just check that someone showed up; they verify that the right people approved the request according to your rules. In CodeCommit, this means specifying how many approvals are needed, who can approve, and under what conditions approval becomes invalid.

The core component here is the **approval rule template**. This is a reusable JSON-based configuration that you can apply to multiple repositories, ensuring consistent governance across your organization. Rather than manually configuring the same approval requirements in each repository, you define the rule once as a template and associate it with repositories that need it.

### Creating Your First Approval Rule

Let's start with a practical example. Suppose you want to ensure that at least two developers approve any changes before they're merged into your main branch. Here's how you'd set that up using the AWS CLI:

```bash
aws codecommit create-approval-rule-template \
  --approval-rule-template-name "two-approvals-required" \
  --approval-rule-template-description "Requires two approvals before merging" \
  --approval-rule-template-content '{
    "Version": "2020-07-20",
    "DestinationReferences": ["refs/heads/main"],
    "Statements": [
      {
        "NumberOfApprovalsNeeded": 2,
        "ApprovalPoolMembers": ["arn:aws:iam::123456789012:root"]
      }
    ]
  }'
```

Once you've created the template, you associate it with your repository:

```bash
aws codecommit associate-approval-rule-template-with-repository \
  --approval-rule-template-name "two-approvals-required" \
  --repository-name "my-application"
```

Now, whenever someone opens a pull request against the main branch in that repository, CodeCommit will automatically enforce the requirement that two people must approve the changes before merging is allowed.

### Configuring Approval Rule Content

The approval rule template content is where the real sophistication emerges. Let's break down the JSON structure and explore what you can control.

The **DestinationReferences** field specifies which branch or branches the rule applies to. You can target specific branches like `refs/heads/main`, use wildcards like `refs/heads/release/*`, or even apply a rule to all branches. This flexibility lets you have different approval requirements for different branches—perhaps main requires two approvals, but feature branches only need one.

The **Statements** array contains the actual approval requirements. Within each statement, `NumberOfApprovalsNeeded` is straightforward: it sets the minimum number of approvals required. But the real power lies in the `ApprovalPoolMembers` field.

The approval pool isn't always about specific individuals. You can specify entire IAM roles or even use wildcard patterns. For example, if you want any developer with an IAM role that matches a pattern to be able to approve, you might use:

```json
{
  "Version": "2020-07-20",
  "DestinationReferences": ["refs/heads/main"],
  "Statements": [
    {
      "NumberOfApprovalsNeeded": 2,
      "ApprovalPoolMembers": ["arn:aws:iam::123456789012:role/Developer*"],
      "ApprovalRuleContent": {
        "ExclusiveMaximumNumberOfApprovals": 1
      }
    }
  ]
}
```

This configuration allows any role matching the pattern to approve, but limits each person to one approval. This prevents a single developer from providing multiple approvals to bypass the rule.

### Handling Stale Approvals

Here's a scenario that trips up many teams: a developer approves a pull request, then the author makes significant changes in response to other feedback. Is the original approval still valid? With CodeCommit approval rules, you can specify that approvals become invalid—or "stale"—when new commits are pushed.

This is controlled through the `DismissStaleApprovalOnPush` and `DissmissApprovalOnCommit` settings:

```json
{
  "Version": "2020-07-20",
  "DestinationReferences": ["refs/heads/main"],
  "Statements": [
    {
      "NumberOfApprovalsNeeded": 2,
      "ApprovalPoolMembers": ["arn:aws:iam::123456789012:role/Developer"],
      "ApprovalRuleContent": {
        "DismissStaleApprovalOnPush": true,
        "DismissApprovalOnCommit": false
      }
    }
  ]
}
```

Setting `DismissStaleApprovalOnPush` to true means that when new commits are pushed to the pull request branch, previous approvals are invalidated, and reviewers must approve again. This ensures that approvals actually reflect the final state of the code, not an earlier version. `DismissApprovalOnCommit` is more granular—if true, approvals are dismissed specifically when the committer is different from the approver, which can be useful for preventing self-approval scenarios.

### Using Approval Rule Templates for Organization-Wide Governance

While you can create approval rules directly in a repository, templates are where CodeCommit shines for scaling governance. Instead of documenting "all repositories should have two approvals required," you encode that directly into infrastructure.

Consider an organization with multiple teams and repositories. You might define several templates:

- **production-template**: Requires three approvals for production-bound code, with additional restrictions on who can approve
- **release-template**: Requires two approvals for release branches, with the option to dismiss stale approvals
- **develop-template**: Requires one approval for development branches, with more relaxed restrictions

You create these templates once and then associate them with repositories as needed:

```bash
# Associate the production template with critical repositories
for repo in payment-service auth-service data-pipeline; do
  aws codecommit associate-approval-rule-template-with-repository \
    --approval-rule-template-name "production-template" \
    --repository-name "$repo"
done
```

When you need to update your approval policies across the entire organization, you simply update the template, and all associated repositories immediately reflect the change. This is vastly more manageable than manually updating each repository's rules.

### Integrating with Notifications

Approval rules mean nothing if your team doesn't know about pending reviews. This is where integrating CodeCommit events with SNS (Simple Notification Service) or Lambda becomes essential.

CodeCommit emits events through CloudWatch Events (or EventBridge in newer AWS terminology) whenever certain actions occur, including pull request creation and approval state changes. You can use these events to trigger notifications.

Here's how you'd set up an SNS notification when a pull request is created:

```bash
# Create an SNS topic for pull request notifications
aws sns create-topic --name codecommit-pr-notifications

# Get the topic ARN (you'll need this in the next step)
TOPIC_ARN=$(aws sns get-topic-attributes \
  --topic-name codecommit-pr-notifications \
  --attribute-name TopicArn \
  --query 'Attributes.TopicArn' \
  --output text)

# Create an EventBridge rule
aws events put-rule \
  --name codecommit-pr-rule \
  --event-pattern '{
    "source": ["aws.codecommit"],
    "detail-type": ["CodeCommit Pull Request State Change"],
    "detail": {
      "event": ["pullRequestCreated"]
    }
  }' \
  --state ENABLED

# Add the SNS topic as a target
aws events put-targets \
  --rule codecommit-pr-rule \
  --targets "Id"="1","Arn"="$TOPIC_ARN"
```

For more sophisticated workflows, you might use Lambda to process CodeCommit events and send richly formatted messages. For instance, you could trigger a Lambda function that queries the pull request details and sends a formatted message to Slack, directly linking reviewers to the code that needs approval.

Here's a simplified Python Lambda function that could process CodeCommit events:

```python
import json
import boto3

codecommit = boto3.client('codecommit')

def lambda_handler(event, context):
    # Extract pull request details from the event
    repository_name = event['detail']['repositoryName']
    pull_request_id = event['detail']['pullRequestId']
    
    # Get pull request details
    response = codecommit.get_pull_request(
        repositoryName=repository_name,
        pullRequestId=pull_request_id
    )
    
    pr_data = response['pullRequest']
    
    # Format notification message
    message = f"""
    New Pull Request: {pr_data['title']}
    Repository: {repository_name}
    Author: {pr_data['authorArn']}
    Status: {pr_data['pullRequestStatus']}
    """
    
    # Send to SNS, Slack, or other notification service
    # ... send notification code here ...
    
    return {
        'statusCode': 200,
        'body': json.dumps('Notification sent')
    }
```

The key insight here is that automation reduces friction. When reviewers get notified immediately when code is ready for review, and they can see the PR details without navigating away from their current context, approval times decrease and code quality improves.

### Comparing CodeCommit Approval Rules to GitHub Branch Protection

If you're familiar with GitHub's branch protection rules, you might wonder how CodeCommit compares. While the concepts are similar, the implementations differ in some important ways.

GitHub's branch protection rules are repository-scoped and defined directly within the repository settings. CodeCommit offers templates that provide organization-wide consistency without duplication. This is a significant advantage for larger organizations where you want uniform governance.

CodeCommit approval rules also integrate more deeply with IAM, allowing you to define approval pools based on IAM roles rather than just GitHub teams. This can be more natural if your organization already uses IAM as the source of truth for access control.

However, GitHub provides real-time enforcement checks within the pull request interface, showing at a glance whether a PR is ready to merge. CodeCommit's integration is more event-driven; you rely on automated notifications to keep people informed. For many workflows, this is actually preferable because it removes the temptation to manually override protections.

One nuance worth mentioning: CodeCommit allows you to automatically dismiss approvals when new commits are pushed, whereas GitHub requires manual action to dismiss reviews. If stale approvals are a concern in your workflow, CodeCommit's approach keeps things moving without requiring pull request authors to manually dismiss reviews.

### Best Practices for Approval Rules

When implementing approval rules in your organization, keep a few principles in mind.

**Start simple and iterate.** You don't need perfect governance on day one. Begin with one or two basic approval rules—perhaps "main branch requires two approvals"—and refine from there based on what you learn about your team's actual workflow.

**Use templates from the start.** Even if you only have a few repositories today, define your approval policies as templates. This establishes the pattern and makes scaling painless when you add new repositories.

**Consider branch-specific requirements.** Not all branches deserve equal scrutiny. Main or production branches might require three approvals, while develop branches require one. Templates make this easy to manage.

**Balance rigor with speed.** Approval rules exist to catch problems early, but overly restrictive rules can bottleneck development. If a rule consistently blocks legitimate changes, it's sending a signal that the rule needs adjustment.

**Monitor approval rule effectiveness.** CloudWatch can help you track metrics like average approval time and how often rules actually prevent merges. Use this data to inform whether your rules are hitting the right balance.

### Troubleshooting Common Approval Rule Issues

In practice, you'll occasionally encounter situations where approval rules behave unexpectedly. Here's how to debug common issues.

If a pull request suddenly shows as "not approvable," the most likely cause is that the approver doesn't match the `ApprovalPoolMembers` pattern in your rule. Double-check the IAM ARN pattern and ensure the person trying to approve has the correct IAM role or principal.

If approvals keep disappearing after commits are pushed, you've likely enabled `DismissStaleApprovalOnPush`. This is actually working as designed, but if it's disrupting your workflow, you can disable it or be more selective about which branches it applies to.

When approval rules aren't appearing in a repository where you expect them, verify that the template has actually been associated with that repository. It's easy to create a template but forget the association step.

Finally, if EventBridge notifications aren't firing, check that your event pattern correctly matches the CodeCommit events being emitted. The event structure can be subtle—for example, distinguishing between `pullRequestCreated` and other pull request state changes.

### Putting It All Together

A complete approval workflow in CodeCommit typically looks like this: a developer creates a pull request against main, CodeCommit evaluates the approval rule for that branch, and an EventBridge rule triggers an SNS notification (or Lambda function) that alerts reviewers. As reviewers approve the pull request, CodeCommit tracks the count of approvals. Once the required number of approvals is met, the pull request can be merged.

If new commits are pushed during review, and your rule has `DismissStaleApprovalOnPush` enabled, any existing approvals are invalidated, and the process starts again—ensuring that approvals always reflect the final state of the code.

The combination of approval rules, templates, and event-driven notifications creates a robust governance framework that scales from small teams to large organizations. It enforces code review practices without requiring manual intervention or workarounds, and it integrates naturally with the rest of your AWS infrastructure.

### Conclusion

CodeCommit approval rules are a foundational piece of CI/CD governance in AWS. By understanding how to configure them, apply them consistently through templates, and integrate them with notifications, you can enforce code review practices that improve quality and reduce risk—all without slowing down development.

The key takeaway is that governance should be automated and consistent. Rather than relying on process documents and hoping developers follow them, encode your policies directly into your repositories through approval rules. Use templates to scale these policies across your organization, and use notifications to keep your team informed. When done well, approval rules become invisible to developers—they simply work, ensuring that code review happens consistently without constant friction or manual intervention.
