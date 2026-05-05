---
title: "Cognito Identity Pool Role Mapping: Rules-Based and Token-Based Approaches"
---

## Cognito Identity Pool Role Mapping: Rules-Based and Token-Based Approaches

When you're building applications on AWS that need to grant users permissions to access AWS services and resources, you'll eventually encounter a critical design decision: how do you map individual users to the appropriate IAM roles? If you're using Amazon Cognito for authentication, this is where Cognito Identity Pools enter the picture. But unlike simple authentication scenarios, Identity Pools introduce a layer of complexity—and flexibility—through two distinct mechanisms for assigning roles to users. Understanding the difference between rules-based and token-based role mapping is essential for building secure, scalable, and maintainable applications.

In this article, we'll explore both approaches in depth, examine when to use each, and walk through practical patterns for real-world scenarios like multi-tenant systems where different users need different permissions.

### Understanding the Cognito Authentication and Authorization Gap

Before diving into role mapping, let's clarify why we need this mechanism at all. Amazon Cognito User Pools handle *authentication*—they verify who you are. But authentication alone doesn't grant you permission to do anything. After a user successfully authenticates with a User Pool, they need *authorization*—the ability to access AWS resources like S3 buckets, DynamoDB tables, or Lambda functions.

This is where Cognito Identity Pools come in. An Identity Pool takes the authentication token from your User Pool and exchanges it for temporary AWS credentials with an associated IAM role. That IAM role defines what the user can actually do. The mechanism for deciding which role gets assigned is where rules-based and token-based mapping differentiate themselves.

Think of it this way: your User Pool is the bouncer at a nightclub who checks your ID. Your Identity Pool is the host who looks at your ID and decides which section of the club you can access based on who you are.

### The Foundation: How Cognito Identity Pool Role Mapping Works

When a user authenticates and requests credentials from an Identity Pool, AWS must decide which IAM role to assume on behalf of that user. This decision happens in one of two ways. The Identity Pool configuration determines which approach applies, and this choice has significant implications for your architecture.

The fundamental requirement is that you've already authenticated the user—they've provided valid credentials to your User Pool and received a token. Now that token travels to the Identity Pool, which uses it as the basis for a role selection decision.

### Rules-Based Role Mapping: Fine-Grained Control

Rules-based role mapping is the traditional and more straightforward approach. You define explicit rules within the Identity Pool configuration that evaluate claims from the user's authentication token or from external identity providers. Based on the outcome of these rules, the Identity Pool selects an appropriate IAM role.

When you use rules-based mapping, you're defining a logical flow: "If this condition is true, use this role. If that other condition is true, use that role." The conditions can match against several attributes from the user's token or identity context.

The most common attributes you can match against include the `cognito:sub` (subject identifier, which is a unique ID for the user), custom claims you've added to the token, or attributes from SAML identity providers if you're using federation. You can also match against the identity pool ID itself, which is useful when you have multiple Identity Pools and want different behavior in each.

Let's look at a concrete example. Suppose you're building a SaaS application where users belong to different organizations. You might have added a custom claim called `organization_id` to each user's token during authentication. Your Identity Pool rules could look like this:

```
Rule 1: If cognito:sub matches "org-123:*" → Assign OrgAdminRole
Rule 2: If cognito:sub matches "org-456:*" → Assign OrgUserRole
Rule 3: Default → Assign BasicUserRole
```

Or, using custom claims:

```
Rule 1: If custom:organization_id == "acme-corp" → Assign AcmeCorporationRole
Rule 2: If custom:organization_id == "widgets-inc" → Assign WidgetsIncRole
Rule 3: Default → Assign StandardTenantRole
```

To set up rules-based mapping via the AWS CLI, you'd configure your Identity Pool with a `RoleMappingType` of `Rules` and define the specific rules:

```bash
aws cognito-identity update-identity-pool \
  --identity-pool-id us-east-1:12345678-1234-1234-1234-123456789012 \
  --role-mapping-type Rules \
  --rules-configuration '{
    "RulesConfiguration": [
      {
        "Claim": "custom:organization_id",
        "MatchType": "Equals",
        "Value": "acme-corp",
        "RoleARN": "arn:aws:iam::123456789012:role/AcmeCorporationRole"
      }
    ]
  }'
```

The key advantage of rules-based mapping is its granularity and explicit control. You can see exactly what rules are defined, audit them easily, and modify them without touching the token generation logic. This makes it excellent for scenarios where you have a clear, predefined set of role assignments.

However, this granularity comes with a limitation: if you have hundreds or thousands of users or organizations, defining individual rules for each becomes unmanageable. The rule configuration lives in the Identity Pool definition, so every new organization would require an update to the Identity Pool itself—a configuration change that requires redeploy or reconfiguration.

### Token-Based Role Mapping: Dynamic Flexibility

Token-based role mapping inverts the problem. Instead of defining rules in the Identity Pool, you embed the role information directly in the user's token at the time of authentication. When the user exchanges their token for AWS credentials, the Identity Pool reads the embedded role from the token and uses it directly.

With token-based mapping, the role assignment logic is handled by your authentication system—typically custom Lambda functions triggered during the Cognito token generation process. This gives you far more flexibility because you can implement any logic you want without modifying the Identity Pool configuration.

For example, you could write a Lambda function that checks a database to determine a user's role based on their organization membership, department, or any other attribute. The Lambda function then adds a claim to the token specifying which role the user should assume.

Here's a conceptual example. Your Lambda function might look something like this:

```python
def lambda_handler(event, context):
    user_id = event['userName']
    
    # Query your database or external service
    organization_id = get_user_organization(user_id)
    role_arn = get_role_for_organization(organization_id)
    
    # Add the role to the token
    event['response']['claimsOverrideDetails'] = {
        'claimsToAddOrOverride': {
            'https://aws.amazon.com/roles': role_arn,
            'https://aws.amazon.com/rolesession': 'user-session-name'
        },
        'claimsToSuppress': [],
        'suppressDefaultClaims': False
    }
    
    return event
```

To enable token-based mapping, you'd configure your Identity Pool with a `RoleMappingType` of `Token`:

```bash
aws cognito-identity update-identity-pool \
  --identity-pool-id us-east-1:12345678-1234-1234-1234-123456789012 \
  --role-mapping-type Token
```

The power of token-based mapping lies in its flexibility. You can modify role assignment logic without touching your Identity Pool configuration. Need to add a new organization? Just update your Lambda function or database. The Identity Pool doesn't need to change. This is particularly valuable in multi-tenant architectures where organizations are added frequently or dynamically.

However, this flexibility introduces complexity. The role assignment logic is now distributed—it lives in your Lambda function, your database, or wherever you've implemented it. Auditing becomes more complex because role assignments aren't explicitly defined in one place. You need strong logging and monitoring to understand which users got which roles and why.

### Comparing the Two Approaches

Let's synthesize the differences with a practical lens. Rules-based mapping works beautifully when you have a manageable number of roles and a predictable, stable set of role-to-user mappings. It's explicit, auditable, and easy to understand at a glance. If you have ten organizations and each maps to one specific role, rules-based mapping is perfect.

Token-based mapping shines when you need dynamic role assignment or have a large number of possible mappings. It centralizes role logic and removes it from infrastructure configuration. If your role assignments depend on real-time database queries, user preferences, or conditional logic, token-based mapping is the way to go.

In terms of performance, token-based mapping introduces a dependency on your Lambda function executing successfully. If your Lambda is slow or fails, credential exchange fails. Rules-based mapping is typically faster because it's purely configuration-driven with no external dependencies. However, in practice, the difference is negligible for most applications unless you have extreme scale or very strict latency requirements.

### Multi-Tenant Role Assignment Patterns

Let's ground this in a realistic scenario: you're building a SaaS product where multiple organizations use your application, and each organization's users should only be able to access their own data in S3, DynamoDB, or other AWS services.

With rules-based mapping, you might create a role for each organization. Your User Pool would assign a custom claim during signup indicating which organization the user belongs to. Then, your Identity Pool would use rules to match that claim to the appropriate role:

```
Rule 1: If custom:organization_id == "org-1" → OrgRole1
Rule 2: If custom:organization_id == "org-2" → OrgRole2
Rule 3: If custom:organization_id == "org-3" → OrgRole3
...
Rule N: Default → RestrictedRole
```

Each role would have a policy limiting access to S3 buckets or DynamoDB tables matching that organization's ID:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/org-${aws:username}/*"
    }
  ]
}
```

This works well up to a point. But if you're adding new organizations dynamically or want to implement tiered access (free tier users get read-only, premium users get read-write), the rule list grows unwieldy.

With token-based mapping, you'd instead implement the role assignment in your authentication flow. A Lambda function triggered during token generation could query your database, determine the organization and tier, and return the appropriate role ARN:

```python
def lambda_handler(event, context):
    user_id = event['userName']
    
    # Query your database
    user_data = db.query_user(user_id)
    organization_id = user_data['organization_id']
    tier = user_data['subscription_tier']
    
    # Determine the role based on organization and tier
    if tier == 'premium':
        role = f"arn:aws:iam::123456789012:role/PremiumOrgRole"
    else:
        role = f"arn:aws:iam::123456789012:role/FreeOrgRole"
    
    event['response']['claimsOverrideDetails'] = {
        'claimsToAddOrOverride': {
            'https://aws.amazon.com/roles': role,
            'https://aws.amazon.com/rolesession': organization_id
        },
        'claimsToSuppress': [],
        'suppressDefaultClaims': False
    }
    
    return event
```

In this pattern, you might have just two roles: PremiumOrgRole and FreeOrgRole. Their IAM policies use the `aws:userid` context variable to ensure isolation:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-bucket/${aws:userid}/*"
    },
    {
      "Effect": "Allow",
      "Action": "s3:PutObject",
      "Resource": "arn:aws:s3:::my-bucket/${aws:userid}/*"
    }
  ]
}
```

This approach scales better because you're not creating a new Identity Pool rule for each organization. Your actual roles remain minimal, and the role assignment logic is entirely in your Lambda function.

### Practical Considerations and Gotchas

One important detail: when using token-based mapping, the role ARN you embed in the token must be specified using the correct claim structure. AWS looks for the `https://aws.amazon.com/roles` claim to determine the role. If you misspell this or use a different claim name, the credential exchange will fail.

Another consideration: both approaches require that the roles you're assigning actually exist. If your Lambda function tries to assign a role that doesn't exist, or if your rule references a non-existent role ARN, credential exchange fails. Always validate that roles exist before attempting to use them.

Rules-based mapping has a practical limit on the number of rules you can configure—typically you're looking at a reasonable number like 25-50 rules, though the actual limit depends on your configuration complexity and the total size of your Identity Pool definition. Beyond that, you'll find management becomes unwieldy, and token-based mapping becomes more attractive.

With token-based mapping, be aware that you're introducing Lambda as a dependency in your authentication flow. This means Lambda cold starts could theoretically impact login latency, though in practice this is usually minimal. More importantly, if your Lambda function throws an error or times out, credential exchange fails. Ensure your Lambda has appropriate error handling, logging, and monitoring.

One subtle but important distinction: in token-based mapping, you're not creating new IAM roles for each user or organization. You're assigning the same role to multiple users and relying on IAM policies and session tags to provide isolation. This is more efficient and cleaner than creating hundreds of roles.

### Hybrid Approaches

In practice, many sophisticated systems use a hybrid approach. You might use token-based mapping for the primary role assignment (determining whether the user gets an AdminRole or UserRole), and then use session tags embedded in the token to provide fine-grained isolation. The role remains the same, but the session tags—which are available to your application code and IAM policies—vary per user.

For example:

```python
event['response']['claimsOverrideDetails'] = {
    'claimsToAddOrOverride': {
        'https://aws.amazon.com/roles': 'arn:aws:iam::123456789012:role/UserRole',
        'https://aws.amazon.com/principal_tags': {
            'organization_id': organization_id,
            'tier': tier
        }
    },
    'claimsToSuppress': [],
    'suppressDefaultClaims': False
}
```

Your IAM policies can then use these principal tags:

```json
{
  "Effect": "Allow",
  "Action": "dynamodb:Query",
  "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/UserData",
  "Condition": {
    "StringEquals": {
      "aws:PrincipalTag/organization_id": "${dynamodb:LeadingKeys}"
    }
  }
}
```

This approach gives you the flexibility of token-based mapping with the simplicity and efficiency of role reuse.

### Making the Decision

So which approach should you choose? Start with rules-based mapping if your role assignments are static, well-defined, and manageable in number. It's simpler, requires no Lambda functions, and provides clear auditability. If you're building a small SaaS application with five or ten organizations, rules-based is probably your answer.

Switch to token-based mapping if you need dynamic role assignment, have a large number of possible roles or organizations, or want to centralize role assignment logic. It's more complex but infinitely more flexible. If your role assignments depend on real-time data or if you're adding new organizations frequently, token-based mapping is worth the added complexity.

Regardless of your choice, always start with the principle of least privilege. Give users and roles only the permissions they actually need, log role assignments for auditability, and test your configuration thoroughly before deploying to production.

### Conclusion

Cognito Identity Pool role mapping is a powerful mechanism for translating authentication into authorization, but it requires thoughtful design. Rules-based mapping offers simplicity and auditability when you have a manageable number of roles. Token-based mapping provides flexibility and scalability when your role assignments need to be dynamic or data-driven.

The choice between them depends on your application's complexity, the number of distinct roles you need to manage, and whether your role assignments change frequently. Many successful applications use both—token-based mapping for the primary role and rules-based conditions or session tags for fine-grained isolation. Understanding both approaches gives you the flexibility to make the right architectural decision for your specific requirements.
