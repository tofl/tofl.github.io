---
title: "Session Tags in AWS STS: Passing Attributes Through Role Assumption"
---

## Session Tags in AWS STS: Passing Attributes Through Role Assumption

Every modern cloud application needs a flexible, scalable way to control access. Hard-coded role definitions don't cut it when you're managing dozens of environments, teams, or customer tenants. This is where session tags come in. They're one of AWS's most underutilized but powerful features for implementing attribute-based access control (ABAC), allowing you to inject dynamic, contextual information directly into temporary security credentials as users assume roles.

In this article, we'll explore how session tags flow through AWS Security Token Service (STS), how they differ from principal tags, and—most importantly—how to use them to build flexible, tag-driven authorization policies. Whether you're designing a multi-tenant SaaS platform, federating external identity providers, or building a sophisticated permission model, understanding session tags will fundamentally change how you approach AWS access control.

### Understanding Session Tags and Their Purpose

A session tag is a key-value pair attached to temporary security credentials when a principal assumes a role through AWS STS. Unlike resource tags or principal tags that exist on IAM identities, session tags are ephemeral—they exist only for the lifetime of that temporary session. When the session expires or the user's credentials refresh, the session tags are gone.

Think of session tags as context that you're attaching to a specific moment in time. A user might assume a role at 2 PM as part of project "Alpha," and that context—the project attribute—travels with them throughout their session. If they assume a different role tomorrow for project "Beta," that project attribute changes. This fluidity is precisely what makes session tags so powerful for ABAC implementations.

The practical benefit is clear: instead of creating hundreds of IAM roles to represent every possible combination of team, environment, and responsibility, you create fewer roles and use session tags to determine what actions are allowed within those roles. A single "Developer" role, for example, might allow tagging operations only on resources tagged with the same project value that's in the session tag. This scales elegantly as your organization grows.

### The Three STS Assume Operations

Session tags can be passed through three primary AWS STS operations. Understanding the mechanics of each one is essential because they each have slightly different constraints and use cases.

#### AssumeRole

AssumeRole is the most straightforward way to pass session tags. When one AWS principal assumes a role, they can specify session tags in the request. This commonly occurs when an application or Lambda function needs to assume a role with specific contextual information, or when using cross-account access patterns.

Here's a practical example: imagine a Lambda function that processes customer requests. The function needs to assume a role in a different AWS account, and it wants to pass along the customer ID so that downstream actions are scoped to that customer's data.

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/CrossAccountRole \
  --role-session-name customer-processing \
  --tags Key=CustomerId,Value=cust-12345 Key=Environment,Value=production
```

The response includes temporary credentials (access key, secret key, and session token) along with metadata about the session. Those tags become part of the security context for that session. Any API calls made with those credentials will carry the session tags with them, and IAM policies can reference them via the `aws:PrincipalTag` condition key.

An important constraint to remember: the principal making the AssumeRole call must have explicit permission to perform the `sts:AssumeRole` action on the target role. But there's an additional permission required if you want to pass session tags—the `sts:TagSession` action. We'll dive deeper into that later.

#### AssumeRoleWithSAML

Many enterprises federate identities through SAML 2.0 identity providers like Active Directory Federation Services or Okta. When a user logs in through a SAML IdP and your application needs to give them AWS access, you use the AssumeRoleWithSAML operation.

The key difference here is that session tags aren't passed directly in the AWS API call—they're extracted from SAML assertions. Your SAML IdP includes attributes in the assertion that it returns after a user authenticates, and AWS automatically maps those SAML attributes to session tags.

The mapping works like this: a SAML attribute with a name like `https://aws.amazon.com/SAML/Attributes/SessionDuration` is recognized by AWS and its value becomes the session duration. More usefully, any SAML attribute with a name matching the pattern `https://aws.amazon.com/SAML/Attributes/PrincipalTag/KeyName` will be mapped directly to a session tag. If your IdP includes an attribute named `https://aws.amazon.com/SAML/Attributes/PrincipalTag/Department` with a value of "Engineering," AWS will create a session tag with the key "Department" and value "Engineering."

This is incredibly powerful because your IdP becomes the source of truth for user attributes. The IdP already knows what team someone is on, what cost center they belong to, what projects they have access to—all information already stored in your identity system. Rather than duplicating that data in IAM roles or policies, SAML attribute mapping lets you flow it directly through to AWS.

#### AssumeRoleWithWebIdentity

AssumeRoleWithWebIdentity is designed for mobile apps, single-page applications, and other scenarios where you're using web identity providers like Amazon Cognito, Google, or Facebook. A user logs in through the identity provider, receives a token, and uses that token to assume a role in AWS without needing AWS credentials.

Like SAML, session tags in web identity flows come from the identity provider rather than being explicitly passed by the caller. Amazon Cognito, for instance, can be configured to include custom attributes and group memberships in the token claims. AWS maps Cognito claims to session tags using a similar attribute pattern.

When you're using Amazon Cognito as your identity source, you configure the user pool with custom attributes—things like "team," "cost_center," or "project." These attributes exist in Cognito and are included in the ID token when a user authenticates. Then, when the user exchanges their Cognito token for AWS credentials via AssumeRoleWithWebIdentity, you can map those Cognito attributes to session tags in your trust policy.

### Session Tags versus Principal Tags

A frequent point of confusion is the distinction between session tags and principal tags. Both use the same condition key (`aws:PrincipalTag`) in IAM policies, which makes them seem interchangeable at first glance. But they're fundamentally different, and understanding that difference shapes how you design your access control.

Principal tags are persistent attributes attached directly to an IAM principal—a user, role, or federated user identity in your account. You create them through the AWS Management Console, AWS CLI, or APIs, and they remain until you explicitly remove them. A principal tag represents a stable characteristic of the identity: what team the person belongs to, their job function, their cost center.

Session tags, by contrast, are temporary and created specifically for a session. They're passed when assuming a role and expire when the session expires. They represent context that's specific to that moment or that particular session.

This leads to an important consequence: a principal can assume the same role multiple times with different session tags. A platform engineer might assume the "Developer" role this morning with a session tag of `project=frontend`, make some changes, and then assume it again this afternoon with `project=backend`. The principal identity is the same, but the session tags—and therefore what resources they can access—are different.

In practice, session tags are often better for dynamic, context-specific information, while principal tags work well for stable attributes that rarely change. If you're implementing multi-tenancy where a single developer might work on multiple projects in a day, session tags excel because they're scoped to that work session. If you're labeling team membership or job function, principal tags might be more appropriate because those attributes are relatively static.

That said, you can use both simultaneously. A policy can reference both `aws:PrincipalTag` (which checks principal tags) and `aws:SessionTag` (which checks session tags), giving you flexibility to combine persistent identity attributes with dynamic session context.

### The TagSession Permission

If you want to pass session tags through any of the STS operations we discussed, the principal doing the assuming must have permission. That permission is `sts:TagSession`.

This is a critical security control that's easy to overlook. Without it, a principal can still assume a role, but they can't attach session tags to their session. This allows you to prevent certain principals from injecting arbitrary tags while allowing others to do so.

Here's a practical IAM policy that allows assuming a role and passing session tags:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sts:AssumeRole",
        "sts:TagSession"
      ],
      "Resource": "arn:aws:iam::123456789012:role/ApplicationRole",
      "Condition": {
        "StringEquals": {
          "iam:PassedInlineSessionTags": [
            "Project",
            "Environment"
          ]
        }
      }
    }
  ]
}
```

This policy grants permission to assume the ApplicationRole and to pass session tags, but it restricts which tag keys can be passed. The `iam:PassedInlineSessionTags` condition limits the principal to only passing "Project" and "Environment" tags. If they try to pass a session tag with any other key, the AssumeRole call fails.

You can be even more granular. If you know the session tags should only have specific values, you can add another condition:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "sts:AssumeRole",
        "sts:TagSession"
      ],
      "Resource": "arn:aws:iam::123456789012:role/DataProcessor",
      "Condition": {
        "StringEquals": {
          "aws:RequestTag/Environment": [
            "staging",
            "production"
          ]
        }
      }
    }
  ]
}
```

This policy only permits assuming the role if the session tag "Environment" has a value of either "staging" or "production." This guards against accidental or malicious injection of invalid values.

### Key and Value Constraints

Session tags aren't unlimited. AWS enforces practical limits to prevent abuse and ensure performance.

Each session tag key can be up to 128 characters long, and values are capped at 256 characters. These limits apply to the tag key and value as they appear in the tag itself, not the entire tag statement in the API call. In practice, these limits are rarely constraining. Well-designed tag keys like "Project," "Environment," "CostCenter," or "Owner" are all comfortably under these thresholds.

You can pass a maximum of 50 session tags in a single AssumeRole request. This is a practical limit—if you're approaching 50 tags per session, you're probably over-complicating your attribute model. Most organizations use between 3 and 10 session tags, passing information about the caller's team, the environment they're working in, the project or customer they're associated with, and perhaps their role or responsibility.

For SAML and web identity flows, the limit still applies. If your SAML IdP or Cognito user pool is configured to send more than 50 attributes that map to session tags, AWS will reject the request. This is another reason to be thoughtful about which attributes you flow through to AWS—only map the ones you actually need for authorization decisions.

### Transitive Tags and Role Chaining

Here's where session tags become genuinely clever: they can propagate through role chaining. Imagine a Lambda function assumes a role, and that role's permissions allow it to assume another role to call a downstream service. Do the session tags from the original assumption propagate to the second role assumption? The answer depends on how you configure the second role's trust policy.

This scenario is called transitive tagging. The original caller's session tags flow from the first role through to the second role. This is useful in many microservices architectures where a request moves through multiple AWS services or accounts, and you want the original authorization context to follow the request.

However, transitive tagging must be explicitly allowed. By default, when a role assumes another role, session tags do not propagate. To enable transitive tags, the role being assumed must include a special condition in its trust policy that explicitly permits the tags to pass through.

Here's an example trust policy for a role that accepts transitive session tags:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "lambda.amazonaws.com",
        "AWS": "arn:aws:iam::123456789012:role/DownstreamRole"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:TaggingStrategy": "principalTag"
        }
      }
    }
  ]
}
```

The condition `sts:TaggingStrategy` with a value of `principalTag` allows session tags to be passed through. There's also a value `sessionTag` which allows transitive session tags, and `deniedBothTaggingStrategies` which explicitly denies transitive tagging.

When you enable transitive tags, you're saying, "I trust the caller and their session tags; propagate them through to my session." This is powerful for maintaining authorization context through complex request flows, but it also means you're delegating part of your access control decisions to a previous layer. Use it thoughtfully and only with roles you trust.

### Using Session Tags in IAM Policies

Once you've passed session tags into a session, policies can reference them via the `aws:PrincipalTag` or `aws:SessionTag` condition keys. (The exact key depends on whether you're checking principal tags or session tags, though `aws:PrincipalTag` works for both in many contexts.)

Here's a concrete example: a developer role that can create and manage EC2 instances, but only those tagged with the same project as their current session.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:TerminateInstances",
        "ec2:ModifyInstanceAttribute"
      ],
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringEquals": {
          "ec2:ResourceTag/Project": "${aws:PrincipalTag/Project}"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": "ec2:DescribeInstances",
      "Resource": "*"
    }
  ]
}
```

This policy allows the assume-role principal to manage instances, but only if the instance's "Project" tag matches the session tag "Project" that was passed when they assumed the role. If they assumed the role with `Project=Frontend`, they can only touch instances tagged with `Project=Frontend`. If they assume the role again tomorrow with `Project=Backend`, they can suddenly manage Backend instances instead.

The `${aws:PrincipalTag/Project}` syntax is policy variable substitution—at evaluation time, AWS replaces that placeholder with the actual value of the Project session tag from the current session.

Another common pattern is restricting access by environment:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "rds:DeleteDBInstance",
        "rds:ModifyDBInstance"
      ],
      "Resource": "arn:aws:rds:*:*:db/*",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalTag/Environment": "staging"
        }
      }
    }
  ]
}
```

This approach is even simpler—it doesn't use a policy variable, but directly checks that the session's Environment tag equals "staging." This prevents a developer from accidentally deleting production databases, because even if they have the RDS delete permission, it only applies if their session tag says they're working in staging.

### SAML Attribute Mapping

When using SAML for federation, the mapping between SAML attributes and AWS session tags happens through a specific naming convention. Your SAML IdP includes attributes in the assertion it returns after a user authenticates, and AWS looks for attributes with names matching particular patterns.

The key pattern for session tags is `https://aws.amazon.com/SAML/Attributes/PrincipalTag/TagKeyName`. If your SAML IdP returns an attribute with a name like `https://aws.amazon.com/SAML/Attributes/PrincipalTag/Team` with a value of "DataEngineering," AWS automatically creates a session tag with key "Team" and value "DataEngineering."

The important nuance is that your IdP must actively include these attributes in the SAML response. If your IdP doesn't send them, AWS has nothing to map. So your SAML application configuration—whether that's Active Directory, Okta, or another provider—needs to be set up to include these custom attributes in the SAML assertions.

Here's what the SAML assertion excerpt might look like:

```xml
<saml:Attribute Name="https://aws.amazon.com/SAML/Attributes/PrincipalTag/Team" 
                 NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri">
  <saml:AttributeValue>DataEngineering</saml:AttributeValue>
</saml:Attribute>
<saml:Attribute Name="https://aws.amazon.com/SAML/Attributes/PrincipalTag/CostCenter" 
                 NameFormat="urn:oasis:names:tc:SAML:2.0:attrname-format:uri">
  <saml:AttributeValue>CC-12345</saml:AttributeValue>
</saml:Attribute>
```

When a user logs in through the IdP and your application calls AssumeRoleWithSAML, AWS parses this assertion, extracts attributes matching the principal tag pattern, and creates session tags accordingly. The user gets credentials with session tags for "Team" and "CostCenter," and policies can immediately reference those tags.

The beauty of this approach is that it keeps your SAML IdP as the source of truth. You manage user attributes in Active Directory or Okta, and AWS automatically uses them. If you move a developer to a different team in your IdP, they immediately get different session tags the next time they log in. No need to update IAM policies or roles.

One thing to remember: SAML attribute mapping happens at federation time, which means it's controlled by your IdP's configuration and what claims it chooses to include. You don't have explicit control over it from the AWS side during the AssumeRoleWithSAML call itself. Make sure your IdP is configured to send the attributes you need for your authorization model.

### Amazon Cognito Attribute Mapping

Amazon Cognito operates slightly differently from SAML. When you use Cognito as your identity provider with AssumeRoleWithWebIdentity, session tags come from claims in the Cognito tokens.

Cognito user pools support custom attributes—additional fields beyond the standard ones like email and name. You can add attributes like "Team," "Project," "CostCenter," or any other dimension relevant to your application. These attributes are stored in the Cognito user pool and included in the ID token when a user authenticates.

When your application exchanges a Cognito ID token for AWS credentials via AssumeRoleWithWebIdentity, the trust policy on the role receiving the assumption can be configured to map Cognito claims to session tags. The claim names are typically the custom attribute names prefixed by `cognito:` (e.g., `cognito:team`, `cognito:project`).

Here's a trust policy that maps Cognito attributes to session tags:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:cognito-identity:region:account-id:identitypool/pool-id"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "pool-id"
        }
      }
    }
  ]
}
```

The actual mapping of Cognito claims to session tags happens through the Cognito identity pool's role mapping configuration. You define rules that extract specific claims from the Cognito token and insert them as session tags into the assumed role session.

This is particularly useful for mobile and web applications where you want to control access to AWS resources based on user attributes stored in Cognito. A mobile game, for instance, could store a user's region in Cognito, and when they access game backend services in AWS, that region would automatically be in their session tags, allowing access control policies to scope their data and compute to the right region.

### Building a Complete ABAC Example

Let's bring this all together with a practical multi-tenant SaaS scenario. Imagine a cloud analytics platform where multiple customers use the same application, and you want to ensure strict data isolation and fine-grained access control.

A customer analyst logs in through your web application. Your application uses Amazon Cognito, which has custom attributes for the customer ID and the analyst's role (junior analyst, senior analyst, admin). When they log in, Cognito mints a token with those attributes included.

Your JavaScript application exchanges the Cognito token for AWS credentials using AssumeRoleWithWebIdentity, targeting a role called "AnalystRole." That role's trust policy is configured to map the Cognito claims to session tags:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:cognito-identity:us-east-1:123456789012:identitypool/us-east-1:12345678-1234-1234-1234-123456789012"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "cognito-identity.amazonaws.com:aud": "us-east-1:12345678-1234-1234-1234-123456789012"
        }
      }
    }
  ]
}
```

The "AnalystRole" itself has a policy that controls access based on session tags:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::analytics-data",
        "arn:aws:s3:::analytics-data/customer/${aws:PrincipalTag/CustomerId}/*"
      ],
      "Condition": {
        "StringEquals": {
          "s3:x-amz-server-side-encryption": "AES256"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": "athena:StartQueryExecution",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalTag/CustomerRole": "admin"
        }
      }
    },
    {
      "Effect": "Allow",
      "Action": "athena:GetQueryResults",
      "Resource": "*"
    }
  ]
}
```

When the analyst logs in, they assume the AnalystRole with session tags for CustomerId and CustomerRole automatically pulled from Cognito. If they're customer "12345," they can only read S3 objects under `customer/12345/`. If their role is "junior_analyst," they can't execute new Athena queries—only view results. If they're an "admin," they have full query execution permissions.

The same role serves all customers and all analyst types, but the session tags ensure strict data isolation and responsibility-based access control. Adding a new customer requires no changes to IAM policies; their credentials automatically carry the right session tags based on their Cognito attributes.

### Best Practices and Common Pitfalls

When implementing session tags, a few best practices will save you from common mistakes.

First, keep your tag model simple and stable. You want 3 to 5 tags that cover the dimensions that matter for your authorization decisions—typically something like Customer, Team, Environment, Role, and maybe Project. Avoid tags that change frequently or have many possible values. If a tag has 200 possible values, your policies become unwieldy and your authorization model fragile.

Second, remember that session tags are passed at assumption time. If you need to change what tags are available to someone, you don't modify their IAM permissions; you change what tags are passed when they assume the role. In SAML and Cognito scenarios, that means updating the IdP or the identity pool configuration, not the IAM policies themselves. This is actually a feature—your policies can remain stable while the attribute mappings adapt.

Third, be careful with transitive tags. They're powerful, but they also mean you're trusting intermediate services to properly maintain the authorization context. Only enable transitive tagging when you understand the downstream role and trust it to respect the tags. If you accidentally enable transitive tags in a role that then gets assumed by malicious or buggy code, those tags could be propagated in unintended ways.

A common mistake is forgetting the `sts:TagSession` permission. You'll add session tags to your AssumeRole call and get an "access denied" error that mysteriously mentions TagSession. Remember that you need both `sts:AssumeRole` and `sts:TagSession` in your policy.

Another pitfall is policy variable substitution. The syntax `${aws:PrincipalTag/TagName}` only works in resource-based conditions and in a few specific contexts. It doesn't work everywhere, so test thoroughly and check the AWS documentation if a policy variable doesn't evaluate as expected. If in doubt, use explicit string equality conditions like `StringEquals: {"aws:PrincipalTag/Team": "backend"}` instead.

Finally, make sure your IAM policies actually use the session tags you're passing. It's easy to set up SAML attribute mapping or Cognito claims extraction and assume the tags are being used, when in fact your policies don't reference them at all. The session tags travel along with the credentials, but they have no effect unless your policies explicitly check them. As a sanity check, write a few test policies that deny all access unless a specific session tag is present, and verify the deny works.

### Conclusion

Session tags are a powerful, often overlooked tool for building scalable, maintainable AWS access control systems. By flowing contextual information—whether from SAML IdPs, Cognito, or direct API calls—into temporary credentials, you decouple your authorization model from static IAM role definitions. Your policies become simpler, more reusable, and more dynamic.

The key takeaways are straightforward: session tags are ephemeral attributes that travel with temporary credentials, they're passed through AssumeRole, AssumeRoleWithSAML, and AssumeRoleWithWebIdentity, they require both the assume role permission and the TagSession permission, and IAM policies reference them via `aws:PrincipalTag` conditions using policy variable substitution. SAML IdPs and Cognito automatically map their attributes to session tags with the right configuration, and transitive tags allow context to flow through role chaining.

Whether you're implementing attribute-based access control for a multi-tenant platform, federating an enterprise identity provider, or building complex microservice architectures where authorization context must travel across account boundaries and service calls, session tags give you the flexibility to do it elegantly. The investment in understanding them pays dividends as your system grows.
