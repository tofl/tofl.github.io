---
title: "DynamoDB Fine-Grained Access Control with IAM Condition Keys"
---

## DynamoDB Fine-Grained Access Control with IAM Condition Keys

Imagine you're building a multi-tenant SaaS application where each customer's data lives in a shared DynamoDB table. You absolutely cannot let Alice see Bob's records, and you certainly can't let either of them modify data they don't own. This is where most developers hit a wall: DynamoDB's table-level permissions feel too coarse, and coding access control into every Lambda function feels fragile and repetitive.

The solution lies in IAM condition keys—a powerful but often overlooked feature that lets you enforce fine-grained access control directly at the DynamoDB API layer. By using conditions like `dynamodb:LeadingKeys`, `dynamodb:Attributes`, and `dynamodb:Select`, you can restrict what data users can read, modify, and even see, all without writing a single line of application logic.

In this article, we'll explore how these mechanisms work, why they matter, and how to implement them in real-world scenarios. Whether you're building a consumer app where users should only access their own data, or managing a multi-tenant platform, mastering these techniques will fundamentally change how you approach DynamoDB security.

### Understanding the Challenge: Why Table-Level Permissions Aren't Enough

By default, when you grant a user or application permission to perform an action on a DynamoDB table—say, `dynamodb:GetItem` or `dynamodb:UpdateItem`—that permission applies to the entire table. There's no distinction between rows. A user with `dynamodb:GetItem` permission can theoretically read any item in that table, assuming they have a valid primary key.

In a single-tenant application, this might be fine. The application code itself enforces which user can see which data. But in multi-tenant scenarios, or when you're integrating third-party services, or when you're working with mobile apps using temporary AWS credentials from Amazon Cognito, you need the infrastructure itself to enforce data isolation.

This is the fundamental gap that IAM condition keys fill. They allow you to parameterize IAM policies so that permissions aren't absolute—they're conditional on the user's identity or the data they're trying to access.

### The Core Mechanism: How IAM Condition Keys Work with DynamoDB

IAM condition keys are essentially variables that AWS evaluates at request time. When a user makes a DynamoDB API call, AWS checks the policy conditions against the request context—things like the caller's identity, the table name, the primary key being accessed, and the attributes involved.

The magic of DynamoDB condition keys is that they allow you to reference the caller's identity directly in the policy. Instead of saying "allow this user to read the entire table," you say "allow this user to read items where the partition key equals their user ID." The partition key value is specified in the actual request, so AWS can compare it against the user's identity and either grant or deny the action.

This evaluation happens before your application code runs. If the condition doesn't match, the API call is denied immediately, and your Lambda function never even gets invoked. From a security perspective, this is much stronger than relying on application-layer validation.

### LeadingKeys: The Foundation of User-Scoped Data Access

The `dynamodb:LeadingKeys` condition is the most commonly used tool for implementing user-scoped access in DynamoDB. It restricts a user's access to items where the partition key (or the first component of a composite key) matches a value you specify.

Here's the core idea: you define a policy that says "this user can only perform DynamoDB operations on items where the partition key equals `${aws:username}`" or `${cognito-identity.amazonaws.com:sub}` or whatever identifier you use for that user.

Let's look at a concrete example. Suppose you have a DynamoDB table called `UserProfiles` with `userId` as the partition key. You want each user to be able to read and update only their own profile.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:UpdateItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/UserProfiles",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": [
            "${aws:username}"
          ]
        }
      }
    }
  ]
}
```

When a user named `alice` makes a `GetItem` request with `userId: alice`, the condition matches and the request succeeds. If `alice` tries to get `userId: bob`, the condition fails and the request is denied.

The `ForAllValues` prefix is important—it means that every key component in the request must match one of the values in the condition. For a simple partition key, this ensures the entire partition key matches the user's identity.

#### Working with Cognito-Authenticated Users

In mobile and web applications using Amazon Cognito, you typically don't have traditional AWS usernames. Instead, each user has a unique subject identifier. IAM provides a special context key for this: `cognito-identity.amazonaws.com:sub`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/UserData",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": [
            "${cognito-identity.amazonaws.com:sub}"
          ]
        }
      }
    }
  ]
}
```

When your Cognito user authenticates and receives temporary AWS credentials, those credentials are tagged with their Cognito subject ID. Any DynamoDB request they make will have that ID available in the request context, and AWS will evaluate it against the policy condition.

This pattern is especially powerful because it requires zero custom authorization code. Your Lambda function receives the request, passes it straight to the DynamoDB SDK, and the IAM layer enforces the isolation automatically.

#### Handling Composite Partition Keys

If your table uses a composite partition key (a partition key plus a sort key), `LeadingKeys` still works, but you need to think carefully about how you structure it.

Suppose you have a table where items are partitioned by `tenantId` and then sorted by `itemId`. Users should only see items within their tenant.

```json
{
  "Condition": {
    "ForAllValues:StringEquals": {
      "dynamodb:LeadingKeys": [
        "${aws:userid}:*"
      ]
    }
  }
}
```

In this case, `LeadingKeys` matches against the partition key, but because you're using a wildcard in the sort key portion, any item whose partition key matches the user's ID will be accessible, regardless of sort key.

However, if you need more granular control over both components, you might want to combine `LeadingKeys` with additional conditions, or reconsider your key schema design. `LeadingKeys` is designed primarily for partition key enforcement.

### Attributes: Column-Level Access Control

While `LeadingKeys` controls which items a user can access, the `dynamodb:Attributes` condition controls which columns (attributes) they can access within those items. This is your mechanism for implementing true column-level security.

Imagine a table with employee records that contains fields like `name`, `salary`, `department`, and `ssn`. You might want managers to see `name` and `department`, but only HR staff to see `salary` and `ssn`.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManagerViewEmployeeBasics",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/Employees",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:Attributes": [
            "name",
            "department",
            "employeeId"
          ]
        }
      }
    },
    {
      "Sid": "HRViewAllAttributes",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/Employees",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalTag/Department": "HR"
        }
      }
    }
  ]
}
```

The `dynamodb:Attributes` condition specifies a list of attribute names that the user is allowed to access. When they perform a read operation (like `GetItem` or `Query`), DynamoDB automatically filters the response to include only the specified attributes, even if the item contains others.

It's worth noting that `dynamodb:Attributes` applies to both the request (what you're trying to read or modify) and the response. If a manager tries to write to the `salary` field, the request is denied because `salary` isn't in their allowed attributes list.

#### Attributes with Write Operations

When using `dynamodb:Attributes` with update operations, the condition restricts which attributes can be modified. If you grant `UpdateItem` permission with `dynamodb:Attributes` limited to `["name", "department"]`, the user can only update those fields. Attempting to update `salary` will fail.

This is particularly useful for enforcing that certain fields (like audit timestamps or computed values) can only be modified by privileged accounts, never by end users.

```json
{
  "Sid": "UserCanUpdateOwnProfile",
  "Effect": "Allow",
  "Action": "dynamodb:UpdateItem",
  "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/UserProfiles",
  "Condition": {
    "ForAllValues:StringEquals": {
      "dynamodb:LeadingKeys": ["${aws:username}"],
      "dynamodb:Attributes": ["displayName", "email", "phoneNumber"]
    }
  }
}
```

This policy says: "You can update your own user profile, but only these three fields."

### Select: Controlling Query and Scan Projections

The `dynamodb:Select` condition controls which projection type a user is allowed to use in `Query` and `Scan` operations. This is a coarser grain than `Attributes`, but it's useful for preventing information leakage through projections.

DynamoDB supports four projection types: `ALL_ATTRIBUTES`, `ALL_PROJECTED_ATTRIBUTES`, `KEYS_ONLY`, and specific attribute names. The `dynamodb:Select` condition restricts which of these the user can request.

```json
{
  "Sid": "PublicUsersCanOnlySeeSummary",
  "Effect": "Allow",
  "Action": "dynamodb:Query",
  "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/PublicPosts",
  "Condition": {
    "StringEquals": {
      "dynamodb:Select": "ALL_ATTRIBUTES"
    }
  }
}
```

While this might seem limiting, remember that `dynamodb:Select` is often used in conjunction with `dynamodb:Attributes`. You might allow a user to select all attributes, but only see a subset of them because `Attributes` filters the result.

More commonly, you'd restrict unauthenticated or public users to `KEYS_ONLY` projections, ensuring they only get primary keys without any sensitive data.

```json
{
  "Sid": "AnonymousCanOnlyGetKeys",
  "Effect": "Allow",
  "Action": "dynamodb:Query",
  "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/PublicData",
  "Condition": {
    "StringEquals": {
      "dynamodb:Select": "KEYS_ONLY"
    }
  }
}
```

### Real-World Example: Multi-Tenant SaaS Access Control

Let's tie everything together with a realistic scenario. You're building a project management SaaS where multiple organizations use a shared DynamoDB table. Each organization has users, and users should only see projects and tasks belonging to their organization.

Your table schema looks like this:

- Partition Key: `orgId` (the organization identifier)
- Sort Key: `resourceId` (a unique ID for the project or task within that org)
- Attributes: `orgId`, `resourceId`, `name`, `description`, `assignedTo`, `dueDate`, `budget`, `internalNotes`

Users should see basic project information (`name`, `description`, `dueDate`) but not financial data (`budget`) or internal notes. Admin users can see everything.

Here's the IAM policy for regular users:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "RegularUserViewOwnOrgProjects",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/Projects",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": ["${aws:PrincipalTag/orgId}"],
          "dynamodb:Attributes": [
            "orgId",
            "resourceId",
            "name",
            "description",
            "assignedTo",
            "dueDate"
          ]
        }
      }
    },
    {
      "Sid": "RegularUserUpdateOwnProjects",
      "Effect": "Allow",
      "Action": "dynamodb:UpdateItem",
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/Projects",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": ["${aws:PrincipalTag/orgId}"],
          "dynamodb:Attributes": [
            "name",
            "description",
            "dueDate"
          ]
        }
      }
    }
  ]
}
```

This policy uses `aws:PrincipalTag/orgId`, which assumes your users have been tagged with their organization ID in IAM. When a regular user makes a `Query` request for projects where `orgId = acme-corp`, the policy evaluates: does the user's `orgId` tag equal the requested `orgId`? Yes, so the request is allowed, but only the specified attributes are returned.

If a user from `acme-corp` tries to query `bigtech-corp`'s projects, the `LeadingKeys` condition fails and the request is denied before it even hits DynamoDB.

Here's the admin policy for the same table:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AdminFullTableAccess",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/Projects",
      "Condition": {
        "StringEquals": {
          "aws:PrincipalTag/role": "admin"
        }
      }
    }
  ]
}
```

Notice the admin policy doesn't have `dynamodb:LeadingKeys` or `dynamodb:Attributes` conditions. Admins get full access without these restrictions. This is a common pattern: you have permissive policies for privileged users and restrictive policies for regular users.

### Key Considerations and Common Pitfalls

When implementing fine-grained DynamoDB access control, there are several subtleties worth understanding.

**Condition Operators Matter**: The `ForAllValues:StringEquals` operator means every value in the request must match at least one value in the condition. There's also `StringEquals`, which checks for exact matches, and `StringLike`, which supports wildcards. Choose carefully based on your use case. For `LeadingKeys`, `ForAllValues:StringEquals` is standard because partition keys are singular values.

**Attributes Must Include Keys**: When you use the `dynamodb:Attributes` condition, you should always include the partition key (and sort key, if applicable) in the allowed attributes list. If you don't, DynamoDB won't be able to return results because it can't identify which item is which without the keys.

**Attributes and Projections Interact**: If you specify a projection expression in your application code (like `ProjectionExpression=name,description`), DynamoDB still enforces the IAM `Attributes` condition. The actual returned attributes are the intersection of what you requested and what IAM allows. This is a feature: it means even if your application code has a bug, IAM still protects sensitive data.

**LeadingKeys Only Works with Partition Keys**: If you need fine-grained access control on sort keys, you'll need to implement that in application code or use a different approach, like separate tables per tenant. `LeadingKeys` is specifically designed for partition key matching.

**Condition Keys Aren't Retroactive**: If a user already has broader permissions granted elsewhere in their policy chain, condition keys won't revoke them. IAM uses an additive model: a policy either allows something or doesn't; it can't be overridden by a more restrictive policy. Make sure your overall policy structure is coherent and doesn't have conflicting statements.

### Testing Your Policies

Before deploying fine-grained access control policies to production, you should test them thoroughly. AWS provides the IAM Policy Simulator, which allows you to test whether a specific action is allowed given a particular IAM policy and context.

You can also use the AWS CLI to test directly. Here's an example:

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:user/alice \
  --action-names dynamodb:GetItem \
  --resource-arns arn:aws:dynamodb:us-east-1:123456789012:table/UserProfiles \
  --region us-east-1
```

For more realistic testing, write a small Lambda function that makes DynamoDB requests and observe whether they succeed or fail. Pay special attention to edge cases: what happens if a user has the right `orgId` but is querying a different table? What if they try to access an attribute not in their allowed list?

### Advanced Patterns and Variations

Once you're comfortable with the basics, there are more sophisticated patterns worth exploring.

**Role-Based Access Control (RBAC) on Top of LeadingKeys**: You can combine multiple conditions to implement role-based access control alongside user-scoped access. For example, managers might be allowed to see not just their own items, but items for their entire team:

```json
{
  "Condition": {
    "ForAllValues:StringEquals": {
      "dynamodb:LeadingKeys": [
        "${aws:username}",
        "${aws:PrincipalTag/teamId}:*"
      ]
    }
  }
}
```

This is a bit complex, but it allows flexibility: the user can access items where the partition key is their own username OR where it starts with their team ID.

**Time-Based Access Restrictions**: You can combine condition keys with `aws:CurrentTime` to implement time-based access policies. For example, you might allow read access to all data, but write access only during business hours:

```json
{
  "Effect": "Allow",
  "Action": "dynamodb:UpdateItem",
  "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/SharedData",
  "Condition": {
    "DateGreaterThan": {
      "aws:CurrentTime": "2024-01-01T09:00:00Z"
    },
    "DateLessThan": {
      "aws:CurrentTime": "2024-01-01T17:00:00Z"
    }
  }
}
```

**IP-Based Restrictions**: For additional security, you can restrict DynamoDB access to specific IP ranges using the `aws:SourceIp` condition. This is especially useful for APIs that should only be accessible from your application servers:

```json
{
  "Condition": {
    "IpAddress": {
      "aws:SourceIp": "10.0.0.0/8"
    }
  }
}
```

### Understanding the Limits

Fine-grained DynamoDB access control with IAM condition keys is powerful, but it has limits. The conditions apply at the API level, meaning they can't enforce complex business logic. For example, if your access control rule is "a user can see a project if they're listed in the project's `collaborators` attribute," you can't express that with `dynamodb:LeadingKeys` or `dynamodb:Attributes`. You'd need to implement that logic in your application.

Additionally, batch operations like `BatchGetItem` respect condition keys, but the enforcement happens per item. If you batch-request ten items and only five match your conditions, DynamoDB returns only the five. This is good for security, but it can be surprising if you're not expecting it.

Streams and Global Secondary Indexes (GSIs) add complexity too. The partition key restriction applies to the table's primary key. If users query a GSI with a different partition key, they can potentially bypass `LeadingKeys` restrictions unless you design your GSI carefully. Always think through the full access pattern when using GSIs alongside condition keys.

### Putting It All Together: A Complete Example

Let's build a concrete, deployable example. You're running a multi-user note-taking app. Each user has a separate entry in a `Notes` table with `userId` as the partition key and `noteId` as the sort key. Users should be able to read all their notes, update their own notes, but not see other sensitive attributes like `encryptionKey`.

Here's the complete IAM policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowReadOwnNotes",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/Notes",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": ["${cognito-identity.amazonaws.com:sub}"],
          "dynamodb:Attributes": [
            "userId",
            "noteId",
            "title",
            "content",
            "createdAt",
            "updatedAt"
          ]
        }
      }
    },
    {
      "Sid": "AllowUpdateOwnNotes",
      "Effect": "Allow",
      "Action": "dynamodb:UpdateItem",
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/Notes",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": ["${cognito-identity.amazonaws.com:sub}"],
          "dynamodb:Attributes": [
            "title",
            "content"
          ]
        }
      }
    },
    {
      "Sid": "AllowDeleteOwnNotes",
      "Effect": "Allow",
      "Action": "dynamodb:DeleteItem",
      "Resource": "arn:aws:dynamodb:us-east-1:123456789012:table/Notes",
      "Condition": {
        "ForAllValues:StringEquals": {
          "dynamodb:LeadingKeys": ["${cognito-identity.amazonaws.com:sub}"]
        }
      }
    }
  ]
}
```

This policy ensures that:

1. Users can only query and read items where `userId` matches their Cognito subject ID.
2. When reading, they see only the note content fields, not sensitive metadata.
3. When updating, they can only change the title and content, not system fields.
4. They can delete their own notes, without attribute restrictions (deletion is a binary operation).

A Cognito user with ID `12345-67890` making a `GetItem` request with `userId: 12345-67890` succeeds and returns the allowed attributes. The same user requesting `userId: other-user-id` is denied immediately.

### Conclusion

IAM condition keys represent a fundamental shift in how you can architect security for DynamoDB. Rather than relying entirely on application-layer authorization, you push enforcement into the infrastructure itself. This means stronger guarantees, cleaner code, and a cleaner separation of concerns.

The three core tools—`dynamodb:LeadingKeys` for row-level access, `dynamodb:Attributes` for column-level access, and `dynamodb:Select` for controlling projection scope—give you the building blocks for almost any fine-grained access control scenario. Combined with IAM tagging and context keys, they enable elegant solutions to complex multi-tenant problems.

Start with `LeadingKeys` for user-scoped access. Layer on `Attributes` when you have sensitive columns that some users shouldn't see. And use `Select` when you need to prevent information leakage through projection choices. Test thoroughly, document your policies clearly, and remember that IAM policies are part of your security boundary—they deserve the same care and review as your application code.
