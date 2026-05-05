---
title: "Debugging IAM Permission Errors: A Step-by-Step Guide"
---

## Debugging IAM Permission Errors: A Step-by-Step Guide

There's a particular kind of frustration that comes with encountering an AccessDenied error in AWS. Your code is syntactically correct. Your credentials are valid. The service itself is working fine—but something invisible is standing between you and the resource you're trying to access. That something is always IAM.

Debugging IAM permission errors requires a different mindset than typical troubleshooting. Instead of looking for broken code or misconfigured infrastructure, you're hunting through a complex web of policies, resource permissions, and service-level restrictions. The good news is that AWS provides excellent tooling for this work, and once you understand the systematic approach to take, you'll find that most permission errors yield quickly to investigation.

In this guide, we'll walk through the complete process of identifying and resolving IAM permission errors. We'll start with interpreting error messages, move through the diagnostic tools AWS provides, and finish with strategies for handling the trickier edge cases that often catch people off guard.

### Understanding the Error Message Itself

When you hit an AccessDenied error, your first instinct might be to immediately jump into the AWS console and start checking policies. Resist that urge for a moment. The error message itself often contains vital clues, and learning to read it properly will save you significant time.

A typical AccessDenied error looks something like this:

```
User: arn:aws:iam::123456789012:user/developer
is not authorized to perform: s3:GetObject
on resource: arn:aws:s3:::my-bucket/sensitive-data.txt
with an explicit deny
```

This message is already telling you several important things. You know the identity trying to take the action (the user ARN), the specific action that was denied (the API operation), the resource involved, and critically, whether it was an explicit deny or an implicit deny. That last distinction matters enormously.

An explicit deny occurs when a policy explicitly includes a Deny statement for the action or resource. An implicit deny is the default state—AWS denies everything by default unless something explicitly allows it. These require different investigation approaches. An explicit deny is usually caused by a security policy intentionally blocking something, while an implicit deny usually means someone simply forgot to grant the necessary permission.

Pay close attention to the action name too. It's always in the format `service:Action`. An error saying `s3:GetObject` is different from one saying `s3:ListBucket`, even though both seem related to S3. These are distinct permissions, and you might have one without the other.

### The IAM Policy Simulator: Your First Real Tool

Once you've understood the error message, the IAM Policy Simulator is your next stop. This is a built-in AWS tool that lets you test whether a particular identity would be allowed to perform a specific action on a resource, without actually executing anything.

To access the Policy Simulator, navigate to the IAM console, select the user or role in question, and look for the "Access Analyzer" or "Policy Simulator" option. Alternatively, you can use it standalone from the IAM service dashboard.

The simulator requires three pieces of information to run a test: the identity (user or role), the action you're testing, and the resource. When you run the test, AWS evaluates every policy attached to that identity and tells you whether the action would be allowed or denied, and crucially, which policy caused that result.

Here's where policy simulators shine—they show you the actual policy that resulted in the allow or deny. This is invaluable. You might discover that a policy you thought was granting permissions is actually written in a way that doesn't match your use case, or that a policy you're completely unaware of is causing the deny.

Let's say your user is getting denied on `dynamodb:Query`. You run the simulator and discover that a policy attached to the user allows `dynamodb:Query` but only on tables with a specific naming pattern, and your table name doesn't match. Now you know exactly what to fix—either rename the table, modify the policy, or both.

The simulator also has a "Simulate Custom Policy" mode where you can paste in a policy document you're considering adding, without actually attaching it. This is phenomenally useful for testing policies before you deploy them to production.

### Reading the CloudTrail Logs

While the Policy Simulator tells you what *would* happen in a hypothetical scenario, CloudTrail tells you what *actually* happened when someone tried to access a resource. This is especially valuable when the error occurred in the past or in a production environment where you can't easily reproduce it.

CloudTrail logs every API call made in your AWS account. When a call fails due to permissions, that failure is recorded with full details. To investigate, navigate to the CloudTrail console and look at the event history, filtering by the user or role that experienced the error.

A CloudTrail event for a denied API call looks something like this:

```json
{
  "eventName": "GetObject",
  "eventSource": "s3.amazonaws.com",
  "errorCode": "AccessDenied",
  "errorMessage": "Access Denied",
  "userIdentity": {
    "type": "IAMUser",
    "arn": "arn:aws:iam::123456789012:user/developer"
  },
  "requestParameters": {
    "bucketName": "my-bucket",
    "key": "sensitive-data.txt"
  },
  "sourceIPAddress": "203.0.113.42",
  "userAgent": "aws-cli/2.13.0"
}
```

The key fields here are `errorCode` and `errorMessage`, which confirm the deny, and `requestParameters`, which shows exactly what resource was being accessed. The `userIdentity` section tells you who was making the call.

One important note: CloudTrail entries for denied API calls might take a few minutes to appear in the event history. If you're troubleshooting in real-time, don't be surprised if the event isn't visible immediately.

### Identifying Which Policy Is Causing the Deny

This is where the investigation gets methodical. A user or role can have multiple policies attached—directly attached policies, policies inherited through groups, policies from role trust relationships, and more. Somewhere in that collection is the policy responsible for the deny. Finding it requires systematic checking.

Start by listing all policies attached to the identity. For an IAM user, this includes:

- Policies directly attached to the user
- Policies attached to any groups the user belongs to
- Inline policies defined directly on the user

For an IAM role, you're looking at:

- Policies attached to the role
- The role's trust policy (which controls who can assume the role, not what they can do once they've assumed it)
- If the role is used in a cross-account scenario, any policies in the trusting account that reference this role

Once you have the complete list, the next step is to evaluate each policy against the action and resource in question. The Policy Simulator can help here too—you can disable policies one at a time and re-run the simulation to identify which one is blocking access.

But often, it's faster to just read the policies themselves. Look for any Deny statements, because an explicit deny will always win, even if another policy allows the action. Then look at Allow statements to see if any of them match both your action and your resource.

Here's a policy that commonly trips people up:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:*",
      "Resource": "*"
    }
  ]
}
```

This looks like it allows everything in S3, and it does, but only if the request is unencrypted or uses the default encryption. If you've set up a bucket policy that requires all uploads to use a specific KMS key, this policy won't be enough—you also need permission to use that KMS key, which is a different service entirely. The wildcard in the policy is misleading users frequently.

### Handling Explicit Denies and Permission Boundaries

When your CloudTrail log or Policy Simulator explicitly tells you that access was denied, you're often dealing with one of two scenarios. Either someone intentionally wrote a Deny statement into a policy, or there's a permission boundary in place that's restricting access.

Permission boundaries are a feature many people overlook. A permission boundary acts as a filter on what a user or role can do, regardless of what their attached policies allow. You can think of it as a maximum set of permissions. The user might have a policy that grants `s3:*`, but if a permission boundary restricts them to only `s3:GetObject`, that's all they can do.

Permission boundaries are particularly useful in large organizations where you want to prevent certain roles from doing dangerous things, even if a developer attaches an overly permissive policy. But they're also a frequent source of confusion.

To check for permission boundaries, look at the user or role's permissions summary in the IAM console. If a permission boundary is set, it will be explicitly displayed. You can then view the boundary policy itself and see if it's the culprit.

Service Control Policies (SCPs) are another layer of permission control that can cause unexpected denies. SCPs are organization-level policies that apply to all members of an organizational unit in AWS Organizations. Even if an IAM policy allows something, an SCP can block it. If your organization is using AWS Organizations, and especially if you're operating within a restricted organizational unit, an SCP might be the invisible hand preventing your action.

Checking for SCPs requires accessing AWS Organizations rather than IAM, but the approach is the same—look at the SCPs attached to your account or organizational unit and see if any of them restrict the action you're trying to perform.

### Resource-Based Policies and Cross-Account Access

Some AWS services allow policies to be attached directly to resources. S3 buckets can have bucket policies, DynamoDB tables can have resource-based policies, SNS topics can have resource policies, and so on. These resource-based policies are evaluated separately from identity-based policies.

For a request to succeed, both the identity-based policy (attached to the user or role) AND the resource-based policy (attached to the resource) must allow the action. If either denies it, the request is denied.

This is where cross-account access gets interesting. Imagine you have an S3 bucket in Account A and a user in Account B trying to access it. The user needs permission from their own account's policies AND the bucket policy in Account A must explicitly grant them access. It's not enough for the bucket policy to grant access to anyone in Account B—it has to grant access to that specific user or a principal group that includes them.

A common mistake is setting up the identity-based policy correctly but forgetting the resource-based policy. The user's IAM policy might allow `s3:GetObject`, but the bucket policy might not mention Account B at all, resulting in a deny.

To debug this, check both sides. Look at the user's policies in Account B, then navigate to the bucket in Account A and examine its bucket policy. Both must allow the action for it to succeed.

### Working Through a Real Example

Let's tie this together with a concrete scenario. Suppose you're a developer and you're trying to read a file from an S3 bucket, but you keep getting AccessDenied. Here's how you'd systematically debug it:

First, capture the exact error message and note the action (`s3:GetObject`), the resource (the bucket and key name), and who is making the request (your user ARN).

Second, open the IAM Policy Simulator. Enter your user, select the S3 service, enter `GetObject` as the action, and provide the full S3 resource ARN. Run the simulation.

If the simulator shows an allow, then your identity-based policies are fine. The issue might be the resource policy. Navigate to the bucket, check its bucket policy. Does it grant your user access? If it's a bucket in your own account, it probably doesn't need to—resource policies are often only necessary for cross-account scenarios. But it doesn't hurt to check.

If you don't see an obvious issue in the bucket policy, check whether the bucket has any ACLs or other restrictions. Some organizations disable object ACLs entirely for security, which can sometimes interfere with expectations.

If the simulator shows a deny, click through to see which policy caused it. Navigate to that policy and read it carefully. Does it restrict the action to certain resources? Does it require certain tags to be present? Are there any conditions attached to the statement that might not be met in your case?

If you're still stuck, check whether a permission boundary is set on your user. If it is, examine it. Permission boundaries can be very restrictive.

If you're using a role rather than a user, also verify that the trust policy allows you to assume the role in the first place. A policy might grant permissions, but if you can't assume the role, it doesn't matter.

Finally, if your organization uses AWS Organizations, check the SCPs. They're organization-level and might be blocking your action regardless of what your identity-based policies say.

### Tactics for Avoiding Permission Errors in the First Place

While troubleshooting is important, preventing permission errors from happening is even better. The principle of least privilege is often stated but less often implemented well, in part because it's more work upfront. But the work pays for itself when you don't spend hours debugging permission issues.

When you create a new user or role, think carefully about what that entity actually needs to do. Instead of granting broad permissions like `s3:*`, grant specific actions on specific resources. Write the policy for the exact use case, not for hypothetical future needs.

Use policy variables to make policies more flexible. For example, a policy can restrict access to an S3 bucket to only objects with a prefix matching the user's name: `arn:aws:s3:::my-bucket/${aws:username}/*`. This way, you can attach the same policy to many users and each one can only access their own folder.

Use tags to organize and control access. If your S3 buckets, EC2 instances, and other resources are properly tagged, you can write policies that grant access based on tags, which scales far better than hardcoding resource ARNs.

Test new policies in the Policy Simulator before attaching them. This catches mistakes early.

And finally, regularly audit the policies in your account. Over time, policies accumulate, and old permissions that are no longer needed can linger. Tools like AWS IAM Access Analyzer can help identify unused permissions and suggest what could be safely removed.

### Conclusion

IAM permission errors are frustrating, but they're not mysterious. They're the result of specific policies allowing or denying specific actions on specific resources, and AWS gives you excellent tools to diagnose them. By learning to read error messages carefully, using the Policy Simulator to test hypotheses, checking CloudTrail for what actually happened, and systematically working through all the places policies can be defined—identity-based, resource-based, permission boundaries, and SCPs—you can resolve nearly any permission error.

The key is to approach each error methodically. Understand what action failed and on what resource. Check your identity-based policies first. Then check the resource-based policies. Then check for permission boundaries and SCPs. Work through each layer until you find the gap or the deny, and you'll nearly always find the root cause.

With practice, debugging permission errors becomes less of a mystery and more of a routine investigation. And as you get better at it, you'll find that you can write policies more confidently, knowing you have the skills to fix them when something doesn't work as expected.
